import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { GET as captions } from "@/app/api/captions/[id]/route";
import { GET as download } from "@/app/api/admin/testimonials/[id]/download/route";
import { DELETE as resetPosterRoute, POST as posterRoute } from "@/app/api/admin/testimonials/[id]/poster/route";
import { GET as trimInfoRoute, PUT as trimRoute } from "@/app/api/admin/testimonials/[id]/trim/route";
import { POST as videoRoute } from "@/app/api/admin/testimonials/[id]/video/route";
import { GET as media } from "@/app/api/media/[...key]/route";
import { parseVtt, trimCues, trimVtt } from "@/lib/captions";
import { env } from "@/lib/env";
import { listHistory } from "@/lib/history";
import { runDueJobs } from "@/lib/jobs";
import { ffmpegSeconds, probe, resetFfmpegCheck } from "@/lib/media";
import { saveFile, sniffMime } from "@/lib/storage";
import { createProject, createTestimonial, getTestimonial, isMediaPublic, toPublic, updateTestimonial } from "@/lib/testimonials";
import { appendChunk, createUpload } from "@/lib/uploads";
import { downloadName } from "@/lib/video-tools";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, hasFfmpeg, params, PNG_BYTES, SAMPLE_WEBM, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetFfmpegCheck();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  resetFfmpegCheck();
  ctx.cleanup();
});

const CAPTIONS = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello there\n\n00:00:01.000 --> 00:00:02.000\nThis is great\n\n00:00:02.000 --> 00:00:03.000\nThe end\n";

async function videoTestimonial() {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(SAMPLE_WEBM, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  const stored = await saveFile(SAMPLE_WEBM, sniffMime(head), "video");
  return createTestimonial(projectId, { name: "Ada Lovelace", videoKey: stored.key, videoMime: stored.mime });
}

const exists = (key: string | null) => Boolean(key) && fs.existsSync(path.join(env.uploadsDir, key!));
const json = (body: unknown) => ({ method: "PUT", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) });
const req = (url: string, init: RequestInit = {}) => new Request(`http://localhost${url}`, init);
const hook = () =>
  getDb()
    .insert(schema.webhooks)
    .values({ id: "h", url: "http://127.0.0.1:9/h", secret: "whsec_x", events: '["testimonial.updated"]', active: true, createdAt: new Date() })
    .run();
const events = () => getDb().select().from(schema.webhookDeliveries).all().map((d) => d.event);

describe("VID-01 trim helpers", () => {
  it("VID-01 shifts and clips captions to the kept part, and leaves untrimmed captions as they were", () => {
    const cues = trimCues(parseVtt(CAPTIONS), 500, 2500);
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [0, 0.5, "Hello there"],
      [0.5, 1.5, "This is great"],
      [1.5, 2, "The end"],
    ]);
    expect(trimVtt(CAPTIONS, null)).toBe(CAPTIONS);
    expect(parseVtt(trimVtt(CAPTIONS, { startMs: 1200, endMs: null })).map((c) => c.text)).toEqual(["This is great", "The end"]);
  });

  it("VID-01 builds ffmpeg times only from whole, non-negative milliseconds", () => {
    expect(ffmpegSeconds(2500)).toBe("2.500");
    expect(() => ffmpegSeconds(-1)).toThrow();
    expect(() => ffmpegSeconds(1.5)).toThrow();
    expect(() => ffmpegSeconds(Number.NaN)).toThrow();
  });

  it("VID-04 download names carry only letters, digits and dashes", () => {
    expect(downloadName({ authorName: 'Zoë "x"; rm -rf /' }, "original", "videos/a.webm")).toBe("zoe-x-rm-rf-original.webm");
    expect(downloadName({ authorName: "日本" }, "mp4", "videos/a.mp4")).toBe("testimonial-video.mp4");
  });
});

describe("VID-01..04 routes refuse anyone signed out", () => {
  it("VID-01 VID-02 VID-03 VID-04 answer 401 without a session", async () => {
    const t = await videoTestimonial();
    const p = params({ id: t.id });
    expect((await trimRoute(req(`/x`, { method: "PUT", body: "{}" }), p)).status).toBe(401);
    expect((await trimInfoRoute(req(`/x`), p)).status).toBe(401);
    expect((await posterRoute(req(`/x`, { method: "POST", body: "{}" }), p)).status).toBe(401);
    expect((await videoRoute(req(`/x`, { method: "POST", body: "{}" }), p)).status).toBe(401);
    expect((await download(req(`/x?file=original`), p)).status).toBe(401);
  });

  it("VID-04 downloads the original for the owner as a private attachment", async () => {
    const t = await videoTestimonial();
    const res = await download(req(`/x?file=original`, { headers: adminHeaders() }), params({ id: t.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ada-lovelace-original.webm"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(fs.readFileSync(SAMPLE_WEBM))).toBe(true);
    // No converted MP4 yet, and nothing but the two kinds.
    expect((await download(req(`/x?file=mp4`, { headers: adminHeaders() }), params({ id: t.id }))).status).toBe(404);
    expect((await download(req(`/x?file=../../etc`, { headers: adminHeaders() }), params({ id: t.id }))).status).toBe(400);
  });

  it("VID-02 an uploaded poster is sniffed: an SVG or a text file is refused", async () => {
    const t = await videoTestimonial();
    const post = (file: File) => {
      const body = new FormData();
      body.set("file", file);
      return posterRoute(req(`/x`, { method: "POST", headers: adminHeaders(), body }), params({ id: t.id }));
    };
    expect((await post(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "p.png", { type: "image/png" }))).status).toBe(415);
    const ok = await post(new File([PNG_BYTES], "p.png", { type: "image/png" }));
    expect(ok.status).toBe(200);
    const after = getTestimonial(t.id)!;
    expect(after).toMatchObject({ posterCustom: true, posterAtMs: null });
    expect(after.posterKey).toMatch(/^images\/.+\.png$/);
    expect(listHistory(t.id).some((h) => h.action === "edited" && h.diff.includes("posterKey"))).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg())("VID-01..03 with ffmpeg", () => {
  async function processed() {
    const t = await videoTestimonial();
    await runDueJobs(); // nothing queued yet
    const { queueVideoProcessing } = await import("@/lib/media");
    await queueVideoProcessing(t.id);
    await runDueJobs();
    const done = getTestimonial(t.id)!;
    expect(done.mediaStatus).toBe("ready");
    return done;
  }

  it("VID-01 trims non-destructively: the MP4 is re-cut, the original kept, captions shifted, history and testimonial.updated recorded", async () => {
    hook();
    const t = await processed();
    updateTestimonial(t.id, { captionsVtt: CAPTIONS, status: "approved" }, { quiet: true });
    const res = await trimRoute(req(`/x`, json({ startMs: 1000, endMs: 2500 })), params({ id: t.id }));
    expect(res.status).toBe(200);
    expect(getTestimonial(t.id)).toMatchObject({ trimStartMs: 1000, trimEndMs: 2500, mediaStatus: "queued", editedAfterConsent: true, transcript: "This is great The end" });
    await runDueJobs();

    const cut = getTestimonial(t.id)!;
    expect(cut.mediaStatus).toBe("ready");
    expect(cut.videoOriginalKey).toBe(t.videoOriginalKey);
    expect(cut.videoKey).not.toBe(t.videoKey);
    expect(exists(cut.videoOriginalKey) && exists(cut.videoKey) && exists(cut.posterKey)).toBe(true);
    expect(exists(t.videoKey)).toBe(false); // the old cut is gone
    const len = (await probe(path.join(env.uploadsDir, cut.videoKey!))).durationMs!;
    expect(len).toBeGreaterThan(1300);
    expect(len).toBeLessThan(1800);
    expect(cut.videoDurationMs).toBe(len);

    // The served captions follow the cut; the stored ones keep the original's timeline.
    const vtt = await (await captions(req(`/api/captions/${t.id}`), params({ id: t.id }))).text();
    expect(parseVtt(vtt).map((c) => [c.start, c.text])).toEqual([
      [0, "This is great"],
      [1, "The end"],
    ]);
    expect(cut.captionsVtt).toBe(CAPTIONS);

    // The public never gets the untrimmed original: not as a source, not by its URL.
    const pub = toPublic(cut);
    expect(pub.video!.sources.map((s) => s.url)).toEqual([`/api/media/${cut.videoKey}`]);
    expect(isMediaPublic(cut.videoOriginalKey!)).toBe(false);
    expect(isMediaPublic(cut.videoKey!)).toBe(true);
    const [, ...rest] = cut.videoOriginalKey!.split("/");
    expect((await media(req(`/api/media/${cut.videoOriginalKey}`), params({ key: ["videos", ...rest] }))).status).toBe(404);

    const edit = listHistory(t.id).find((h) => h.action === "edited" && h.diff.includes("trimStartMs"));
    expect(edit).toBeTruthy();
    expect(events()).toContain("testimonial.updated");

    // Undo: the whole video again.
    await trimRoute(req(`/x`, json({ startMs: null, endMs: null })), params({ id: t.id }));
    await runDueJobs();
    const whole = getTestimonial(t.id)!;
    expect(whole).toMatchObject({ trimStartMs: null, trimEndMs: null, transcript: "Hello there This is great The end" });
    expect(isMediaPublic(whole.videoOriginalKey!)).toBe(true);
  });

  it("VID-01 checks the trim against the original's length", async () => {
    const t = await processed();
    const put = async (body: unknown) => trimRoute(req(`/x`, json(body)), params({ id: t.id }));
    expect((await put({ startMs: 0, endMs: 60_000 })).status).toBe(400);
    expect((await put({ startMs: 2000, endMs: 2500 })).status).toBe(400); // under a second
    expect((await put({ startMs: -5, endMs: 2000 })).status).toBe(400);
    expect((await put({ startMs: "1; rm -rf /", endMs: 2000 })).status).toBe(400);
    expect((await put({ startMs: 0.5, endMs: 2000 })).status).toBe(400);
    expect(getTestimonial(t.id)).toMatchObject({ trimStartMs: null, trimEndMs: null });
    const info = await (await trimInfoRoute(req(`/x`, { headers: adminHeaders() }), params({ id: t.id }))).json();
    expect(info.durationMs).toBeGreaterThan(2900);
    expect(info.peaks).toHaveLength(240);
    expect(Math.max(...info.peaks)).toBe(1);
  });

  it("VID-02 picks a frame as the poster, keeps the moment through a re-cut, and an uploaded poster survives a trim", async () => {
    const t = await processed();
    const frame = await posterRoute(req(`/x`, { method: "POST", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ atMs: 2000 }) }), params({ id: t.id }));
    expect(frame.status).toBe(200);
    const picked = getTestimonial(t.id)!;
    expect(picked).toMatchObject({ posterAtMs: 2000, posterCustom: false });
    expect(picked.posterKey).not.toBe(t.posterKey);
    expect(exists(t.posterKey)).toBe(false);
    expect(exists(picked.posterKey)).toBe(true);
    expect((await posterRoute(req(`/x`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ atMs: 99_000 }) }), params({ id: t.id }))).status).toBe(400);

    const body = new FormData();
    body.set("file", new File([fs.readFileSync(path.resolve(__dirname, "../e2e/fixtures/avatar.png"))], "poster.png", { type: "image/png" }));
    await posterRoute(req(`/x`, { method: "POST", headers: adminHeaders(), body }), params({ id: t.id }));
    const custom = getTestimonial(t.id)!.posterKey;
    await trimRoute(req(`/x`, json({ startMs: 500, endMs: 2500 })), params({ id: t.id }));
    await runDueJobs();
    expect(getTestimonial(t.id)!.posterKey).toBe(custom);
    expect(exists(custom)).toBe(true);

    await resetPosterRoute(req(`/x`, { method: "DELETE", headers: adminHeaders() }), params({ id: t.id }));
    const reset = getTestimonial(t.id)!;
    expect(reset).toMatchObject({ posterCustom: false, posterAtMs: null });
    expect(reset.posterKey).toMatch(/\.jpg$/);
    expect(exists(custom)).toBe(false);
  });

  it("VID-03 replaces the video: the pipeline reruns, the trim and poster clear, the transcript is made again, old files go", async () => {
    process.env.TRANSCRIBE_PROVIDER = "command";
    process.env.TRANSCRIBE_COMMAND = `node ${path.resolve(__dirname, "../e2e/fixtures/fake-whisper.mjs")} {input} {output}`;
    try {
      hook();
      const t = await processed();
      await trimRoute(req(`/x`, json({ startMs: 500, endMs: 2500 })), params({ id: t.id }));
      await runDueJobs();
      const before = getTestimonial(t.id)!;

      const { upload, token } = createUpload("video", { projectId, maxBytes: env.maxVideoBytes });
      await appendChunk(upload, 0, new Uint8Array(fs.readFileSync(SAMPLE_WEBM)));
      const res = await videoRoute(
        req(`/x`, { method: "POST", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ upload: { id: upload.id, token } }) }),
        params({ id: t.id }),
      );
      expect(res.status).toBe(200);
      const swapped = getTestimonial(t.id)!;
      expect(swapped).toMatchObject({ trimStartMs: null, trimEndMs: null, posterKey: null, mediaStatus: "queued", transcript: null, captionsVtt: null });
      expect(swapped.videoKey).toBe(swapped.videoOriginalKey);
      for (const k of [before.videoKey, before.videoOriginalKey, before.posterKey]) expect(exists(k)).toBe(false);

      await runDueJobs(); // convert
      await runDueJobs(); // then transcribe
      const done = getTestimonial(t.id)!;
      expect(done.mediaStatus).toBe("ready");
      expect(done.transcriptStatus).toBe("ready");
      expect(done.transcript).toBeTruthy();
      expect(exists(done.videoKey) && exists(done.posterKey) && exists(done.videoOriginalKey)).toBe(true);
      expect(listHistory(t.id).some((h) => h.action === "edited" && h.diff.includes("videoKey"))).toBe(true);
      expect(events().filter((e) => e === "testimonial.updated").length).toBeGreaterThanOrEqual(2);

      // A used or foreign upload is refused.
      const again = await videoRoute(
        req(`/x`, { method: "POST", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ upload: { id: upload.id, token } }) }),
        params({ id: t.id }),
      );
      expect(again.status).toBe(400);
    } finally {
      delete process.env.TRANSCRIBE_PROVIDER;
      delete process.env.TRANSCRIBE_COMMAND;
    }
  });

  it("VID-04 the MP4 download is the cut when trimmed", async () => {
    const t = await processed();
    await trimRoute(req(`/x`, json({ startMs: 1000, endMs: 2500 })), params({ id: t.id }));
    await runDueJobs();
    const res = await download(req(`/x?file=mp4`, { headers: adminHeaders() }), params({ id: t.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ada-lovelace-video.mp4"');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(fs.readFileSync(path.join(env.uploadsDir, getTestimonial(t.id)!.videoKey!)))).toBe(true);
  });
});
