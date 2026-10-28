import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { GET as formVideoCaptions } from "@/app/api/form-videos/[id]/captions/route";
import { DELETE as deleteFormVideoRoute, POST as formVideosRoute } from "@/app/api/admin/forms/[id]/videos/route";
import { GET as media } from "@/app/api/media/[...key]/route";
import { GET as candidatesRoute } from "@/app/api/admin/projects/[id]/reels/candidates/route";
import { GET as listReelsRoute, POST as createReelRoute } from "@/app/api/admin/projects/[id]/reels/route";
import { DELETE as deleteReelRoute, PUT as putReelRoute } from "@/app/api/admin/reels/[id]/route";
import { POST as renderReelRoute } from "@/app/api/admin/reels/[id]/render/route";
import { GET as downloadRoute } from "@/app/api/admin/renders/[id]/download/route";
import { DELETE as deleteRenderRoute, GET as renderRoute } from "@/app/api/admin/renders/[id]/route";
import { POST as multiclipRoute, PUT as useMulticlipRoute } from "@/app/api/admin/testimonials/[id]/multiclip/route";
import { GET as rendersRoute } from "@/app/api/admin/testimonials/[id]/renders/route";
import { POST as socialRoute } from "@/app/api/admin/testimonials/[id]/social-clip/route";
import { POST as teamInvite } from "@/app/api/admin/team/route";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { env } from "@/lib/env";
import { createForm, setFormStatus } from "@/lib/forms";
import { runnerProps } from "@/lib/forms/runner";
import { runDueJobs } from "@/lib/jobs";
import { probe, queueVideoProcessing, resetFfmpegCheck } from "@/lib/media";
import { isMediaKey, saveFile, sniffMime } from "@/lib/storage";
import { createProject, createTestimonial, getProjectById, getTestimonial, isMediaPublic, toPublic, updateTestimonial } from "@/lib/testimonials";
import { appendChunk, createUpload } from "@/lib/uploads";
import { setTrim } from "@/lib/video-tools";
import { assColor, captionsAss, cleanText, MUSIC_BED, wrap } from "@/lib/video/compose";
import { hlsLadder } from "@/lib/video/hls";
import { SOCIAL_LOOKS } from "@/lib/video/looks";
import { reelConfigSchema, reelLengthMs, socialOptionsSchema } from "@/lib/video/reel-config";
import { captionLines, rangeOfWords, wordsBetween, wordsFromText, wordsFromVtt } from "@/lib/video/words";
import { registerJobs } from "@/lib/worker";
import { ADMIN_EMAIL, adminHeaders, hasFfmpeg, params, SAMPLE_WEBM, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetFfmpegCheck();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.VIDEO_HLS;
  delete process.env.PLAUDIT_FEATURES;
  resetFfmpegCheck();
  ctx.cleanup();
});

const CAPTIONS = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello {there}\n\n00:00:01.000 --> 00:00:02.500\nThis is \\N great\n\n00:00:02.500 --> 00:00:03.000\nThe end\n";

/** A dashboard request as the owner (or `email`). */
function req(url: string, init: { method?: string; json?: unknown; email?: string } = {}) {
  const headers: Record<string, string> = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
  headers.cookie = !init.email || init.email === ADMIN_EMAIL ? adminHeaders().cookie : `${sessionCookieName()}=${createSessionToken(init.email)}`;
  return new Request(`http://localhost${url}`, { method: init.method ?? (init.json === undefined ? "GET" : "POST"), headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
}
const anon = (url: string, method = "GET") => new Request(`http://localhost${url}`, { method, headers: { "sec-fetch-site": "same-origin" } });

async function storedVideo() {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(SAMPLE_WEBM, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  return saveFile(SAMPLE_WEBM, sniffMime(head), "video");
}

/** A form submission with a main video and `extra` video answers, converted. */
async function submission(extra = 2, o: { approve?: boolean; captions?: boolean } = {}) {
  const main = await storedVideo();
  const t = createTestimonial(projectId, { name: "Ada Lovelace", title: "CTO", company: "Engines Ltd", videoKey: main.key, videoMime: main.mime });
  getDb().update(schema.testimonials).set({ primaryQuestion: "What did you like?", ...(o.captions ? { captionsVtt: CAPTIONS, transcript: "Hello there" } : {}) }).where(eq(schema.testimonials.id, t.id)).run();
  for (let i = 0; i < extra; i++) {
    const v = await storedVideo();
    getDb()
      .insert(schema.answers)
      .values({ id: crypto.randomUUID(), testimonialId: t.id, questionKey: `q${i}`, questionTitle: `Question {${i + 2}}: how's it going?`, position: i + 1, videoKey: v.key, videoOriginalKey: v.key, videoMime: v.mime })
      .run();
  }
  await queueVideoProcessing(t.id);
  await runDueJobs();
  if (o.approve) updateTestimonial(t.id, { status: "approved" });
  await runDueJobs();
  return getTestimonial(t.id)!;
}

const render = (id: string) => getDb().select().from(schema.videoRenders).where(eq(schema.videoRenders.id, id)).get()!;
const filePath = (key: string) => path.join(env.uploadsDir, key);
const streams = (file: string) =>
  JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8" })) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration: string };
  };

async function invite(email: string, role: "editor" | "viewer") {
  process.env.PLAUDIT_FEATURES = "all";
  const res = await teamInvite(req("/api/admin/team", { json: { email, role, projectIds: null } }));
  expect(res.status, await res.clone().text()).toBe(201);
}

// ------------------------------------------------------------------ pure parts

describe("VID-07 VID-08 words and captions", () => {
  it("VID-07 shares each cue's time over its words, and keeps them in order", () => {
    const words = wordsFromVtt(CAPTIONS);
    expect(words.map((w) => w.text)).toEqual(["Hello", "{there}", "This", "is", "\\N", "great", "The", "end"]);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start);
    expect(words[0].start).toBe(0);
    expect(words[5].end).toBeLessThanOrEqual(2.5);
    expect(wordsFromText("one two three", 3).map((w) => w.text)).toEqual(["one", "two", "three"]);
    expect(wordsBetween(words, 1, 2.5).map((w) => w.text)).toEqual(["This", "is", "\\N", "great"]);
    expect(wordsBetween(words, 1, 2.5)[0].start).toBe(0);
    expect(captionLines(words, 3).map((l) => l.length)).toEqual([3, 3, 2]);
  });

  it("VID-07 burns captions from a file: transcript text can't add ASS override tags, and the spoken word is highlighted", () => {
    const ass = captionsAss({ w: 1080, h: 1920 }, wordsFromVtt(CAPTIONS), {
      size: 60, per: 4, upper: false, color: "#ffffff", active: "#ff8800", edge: "#000000", edgeWidth: 4, align: 2, marginV: 200, marginH: 60,
    });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Style: Cap,Geist,60,");
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(8);
    // One override per event: our own highlight. The transcript's braces and backslash are neutralised.
    for (const e of events) expect(e.match(/\{/g)).toHaveLength(2);
    expect(events[1]).toContain(`{\\c${assColor("#ff8800")}\\1a&H00&}(there){\\r}`);
    expect(ass).not.toContain("\\N");
    expect(assColor("#0f766e")).toBe("&H006E760F");
    expect(cleanText("a{b}\\c\u0007d")).toBe("a(b)/c d");
    expect(wrap("The quick brown fox jumps over the lazy dog again and again", 16, 2)).toEqual(["The quick brown", "fox jumps over…"]);
  });

  it("VID-08 a selection of words becomes the clip's in and out points, in whole milliseconds", () => {
    const words = wordsFromVtt(CAPTIONS);
    expect(rangeOfWords(words, 2, 5)).toEqual({ startMs: 1000, endMs: Math.ceil(words[5].end * 1000) });
    expect(rangeOfWords(words, 5, 2)).toEqual(rangeOfWords(words, 2, 5));
    expect(rangeOfWords([], 0, 1)).toBeNull();
  });

  it("VID-07 VID-08 options are validated: looks, formats, lengths and clip counts", () => {
    expect(socialOptionsSchema.parse({})).toMatchObject({ look: "studio", format: "vertical", captions: true, nameTag: true, logo: true });
    expect(socialOptionsSchema.safeParse({ look: "neon" }).success).toBe(false);
    expect(socialOptionsSchema.safeParse({ format: "landscape" }).success).toBe(false);
    expect(socialOptionsSchema.safeParse({ startMs: 0, endMs: 500 }).success).toBe(false);
    expect(socialOptionsSchema.safeParse({ startMs: 0, endMs: 181_000 }).success).toBe(false);
    expect(socialOptionsSchema.safeParse({ startMs: 1.5 }).success).toBe(false);
    const clip = { testimonialId: "t", startMs: 0, endMs: 5000 };
    expect(reelConfigSchema.safeParse({ clips: Array(21).fill(clip) }).success).toBe(false);
    expect(reelConfigSchema.safeParse({ clips: [{ ...clip, endMs: 121_000 }] }).success).toBe(false);
    expect(reelLengthMs(reelConfigSchema.parse({ title: "Hi", clips: [clip, clip] }))).toBe(13_000);
  });

  it("VID-08 the music is ours: an expression ffmpeg synthesises, with no audio file shipped", () => {
    expect(MUSIC_BED).toMatch(/^[0-9a-zA-Z*+\-().|/ ]+$/);
    expect(MUSIC_BED.split("|")).toHaveLength(2);
    expect(MUSIC_BED).not.toMatch(/[,:;'[\]]/);
    const audio = execFileSync("git", ["ls-files", "*.mp3", "*.wav", "*.ogg", "*.m4a", "*.aac", "*.flac"], { encoding: "utf8" }).trim();
    expect(audio).toBe("");
  });

  it("VID-06 picks two or three renditions, never bigger than the video", () => {
    expect(hlsLadder(1280, 720).map((r) => `${r.w}x${r.h}`)).toEqual(["640x360", "960x540", "1280x720"]);
    expect(hlsLadder(720, 1280).map((r) => `${r.w}x${r.h}`)).toEqual(["360x640", "540x960", "720x1280"]);
    expect(hlsLadder(960, 540).map((r) => `${r.w}x${r.h}`)).toEqual(["640x360", "960x540"]);
    expect(hlsLadder(320, 240).map((r) => `${r.w}x${r.h}`)).toEqual(["320x240"]);
    expect(isMediaKey("hls/00000000-0000-0000-0000-000000000000/master.m3u8")).toBe(true);
    expect(isMediaKey("hls/00000000-0000-0000-0000-000000000000/v1_00012.ts")).toBe(true);
    expect(isMediaKey("hls/00000000-0000-0000-0000-000000000000/../x.ts")).toBe(false);
    expect(isMediaKey("hls/00000000-0000-0000-0000-000000000000/evil.m3u8")).toBe(false);
  });
});

// ------------------------------------------------------------------ routes without ffmpeg

describe("M16 routes need the right role", () => {
  it("VID-05 VID-07 VID-08 refuse signed-out visitors and cross-site requests; viewers may look but not render", async () => {
    const main = await storedVideo();
    const t = createTestimonial(projectId, { name: "Ada", videoKey: main.key, videoMime: main.mime });
    const p = params({ id: t.id });
    expect((await multiclipRoute(anon("/x", "POST"), p)).status).toBe(401);
    expect((await socialRoute(anon("/x", "POST"), p)).status).toBe(401);
    expect((await rendersRoute(anon("/x"), p)).status).toBe(401);
    expect((await createReelRoute(anon("/x", "POST"), params({ id: projectId }))).status).toBe(401);
    const evil = new Request("http://localhost/x", { method: "POST", headers: { ...adminHeaders(), origin: "https://evil.example" } });
    expect((await multiclipRoute(evil, p)).status).toBe(403);

    await invite("vera@team.example", "viewer");
    expect((await rendersRoute(req(`/api/admin/testimonials/${t.id}/renders`, { email: "vera@team.example" }), p)).status).toBe(200);
    expect((await multiclipRoute(req(`/api/admin/testimonials/${t.id}/multiclip`, { json: {}, email: "vera@team.example" }), p)).status).toBe(403);
    expect((await socialRoute(req(`/api/admin/testimonials/${t.id}/social-clip`, { json: {}, email: "vera@team.example" }), p)).status).toBe(403);
    expect((await createReelRoute(req(`/api/admin/projects/${projectId}/reels`, { json: { name: "x" }, email: "vera@team.example" }), params({ id: projectId }))).status).toBe(403);
    expect((await candidatesRoute(req(`/api/admin/projects/${projectId}/reels/candidates`, { email: "vera@team.example" }), params({ id: projectId }))).status).toBe(200);
  });

  it("VID-08 reels are saved per project, validated, and only name this project's testimonials", async () => {
    const other = createProject({ name: "Other", slug: "other" });
    const theirs = createTestimonial(other.id, { name: "Bob", text: "Hi" }, { source: "api" });
    const bad = await createReelRoute(req(`/api/admin/projects/${projectId}/reels`, { json: { name: "Mine", config: { clips: [{ testimonialId: theirs.id, startMs: 0, endMs: 2000 }] } } }), params({ id: projectId }));
    expect(bad.status).toBe(400);
    expect((await createReelRoute(req(`/api/admin/projects/${projectId}/reels`, { json: { name: "" } }), params({ id: projectId }))).status).toBe(400);
    const ok = await createReelRoute(req(`/api/admin/projects/${projectId}/reels`, { json: { name: "Launch reel", config: { title: "Hello" } } }), params({ id: projectId }));
    expect(ok.status).toBe(201);
    const { reel } = await ok.json();
    expect(reel).toMatchObject({ name: "Launch reel", config: { title: "Hello", music: true, format: "landscape", clips: [] }, renders: [] });
    const listed = await (await listReelsRoute(req(`/api/admin/projects/${projectId}/reels`), params({ id: projectId }))).json();
    expect(listed.reels.map((r: { id: string }) => r.id)).toEqual([reel.id]);
    const otherList = await (await listReelsRoute(req(`/api/admin/projects/${other.id}/reels`), params({ id: other.id }))).json();
    expect(otherList.reels).toEqual([]);
    // Rendering a reel without clips says what to do.
    const empty = await renderReelRoute(req(`/api/admin/reels/${reel.id}/render`, { json: {} }), params({ id: reel.id }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/at least one clip/);
    expect((await deleteReelRoute(req(`/api/admin/reels/${reel.id}`, { method: "DELETE" }), params({ id: reel.id }))).status).toBe(204);
  });
});

// ------------------------------------------------------------------ with ffmpeg

describe.skipIf(!hasFfmpeg())("M16 renders with ffmpeg", () => {
  async function finish(id: string) {
    await runDueJobs();
    const r = render(id);
    expect(r.status, r.error ?? "").toBe("ready");
    return r;
  }

  it("VID-05 stitches the main answer and each video answer into one MP4, a title card before each, downloadable by the owner", async () => {
    const t = await submission(2);
    const info = await (await rendersRoute(req(`/api/admin/testimonials/${t.id}/renders`), params({ id: t.id }))).json();
    expect(info.multiclip).toEqual({ clips: 3, inUse: null });
    const res = await multiclipRoute(req(`/api/admin/testimonials/${t.id}/multiclip`, { json: {} }), params({ id: t.id }));
    expect(res.status).toBe(202);
    const { render: queued } = await res.json();
    expect(queued.status).toBe("queued");
    // A second one waits for the first.
    expect((await multiclipRoute(req(`/api/admin/testimonials/${t.id}/multiclip`, { json: {} }), params({ id: t.id }))).status).toBe(409);
    const r = await finish(queued.id);
    const out = streams(filePath(r.key!));
    const video = out.streams.find((s) => s.codec_type === "video")!;
    expect([video.width, video.height]).toEqual([1280, 720]);
    expect(out.streams.some((s) => s.codec_type === "audio")).toBe(true);
    // Three 3 s answers and three 2.5 s cards.
    expect(Number(out.format.duration)).toBeGreaterThan(15.5);
    expect(Number(out.format.duration)).toBeLessThan(18);
    // Owner-only: not public, the owner downloads it as an attachment.
    expect(isMediaPublic(r.key!)).toBe(false);
    expect((await media(anon(`/api/media/${r.key}`), params({ key: r.key!.split("/") }))).status).toBe(404);
    const dl = await downloadRoute(req(`/api/admin/renders/${r.id}/download`), params({ id: r.id }));
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toBe('attachment; filename="ada-lovelace-multiclip.mp4"');
    expect(dl.headers.get("cache-control")).toBe("private, no-store");
    expect((await downloadRoute(anon(`/x`), params({ id: r.id }))).status).toBe(401);
  });

  it("VID-05 needs at least two video answers", async () => {
    const t = await submission(0);
    const res = await multiclipRoute(req(`/api/admin/testimonials/${t.id}/multiclip`, { json: {} }), params({ id: t.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least two video answers/);
  });

  it("VID-05 a multiclip can become the testimonial's video and back, and is public only while it is that and approved", async () => {
    const t = await submission(1, { approve: true });
    const { render: queued } = await (await multiclipRoute(req(`/api/admin/testimonials/${t.id}/multiclip`, { json: {} }), params({ id: t.id }))).json();
    const r = await finish(queued.id);
    const firstOriginal = t.videoOriginalKey!;
    const used = await useMulticlipRoute(req(`/api/admin/testimonials/${t.id}/multiclip`, { method: "PUT", json: { renderId: r.id } }), params({ id: t.id }));
    expect(used.status).toBe(200);
    await runDueJobs();
    const now = getTestimonial(t.id)!;
    expect(now.videoOriginalKey).toBe(r.key);
    expect(now.mediaStatus).toBe("ready");
    expect(now.videoDurationMs).toBeGreaterThan(10_000);
    expect(isMediaPublic(r.key!)).toBe(true);
    expect(fs.existsSync(filePath(firstOriginal))).toBe(true);
    // It can't be deleted while it's the video; making it again keeps using the first answer.
    expect((await deleteRenderRoute(req(`/api/admin/renders/${r.id}`, { method: "DELETE" }), params({ id: r.id }))).status).toBe(409);
    const info = await (await rendersRoute(req(`/api/admin/testimonials/${t.id}/renders`), params({ id: t.id }))).json();
    expect(info.multiclip).toEqual({ clips: 2, inUse: r.id });
    // Back to the first answer.
    expect((await useMulticlipRoute(req(`/api/admin/testimonials/${t.id}/multiclip`, { method: "PUT", json: { renderId: null } }), params({ id: t.id }))).status).toBe(200);
    await runDueJobs();
    const back = getTestimonial(t.id)!;
    expect(back.videoOriginalKey).toBe(firstOriginal);
    expect(back.mediaStatus).toBe("ready");
    expect(isMediaPublic(r.key!)).toBe(false);
    expect((await deleteRenderRoute(req(`/api/admin/renders/${r.id}`, { method: "DELETE" }), params({ id: r.id }))).status).toBe(204);
    expect(fs.existsSync(filePath(r.key!))).toBe(false);
  });

  it("VID-07 renders 9:16 and 1:1 social clips with burned-in captions in every look, and the owner downloads them", async () => {
    const t = await submission(0, { captions: true });
    // A logo for the looks that draw one.
    const logo = await saveFile(path.resolve(__dirname, "../e2e/fixtures/avatar.png"), "image/png", "image");
    getDb().update(schema.projects).set({ logoKey: logo.key, brand: JSON.stringify({ colors: { primary: "#1d4ed8" } }) }).where(eq(schema.projects.id, projectId)).run();
    const cases = SOCIAL_LOOKS.map((look, i) => ({ look, format: i % 2 ? "square" : "vertical" }));
    for (const c of cases) {
      const res = await socialRoute(req(`/api/admin/testimonials/${t.id}/social-clip`, { json: { ...c, startMs: 500, endMs: 2500 } }), params({ id: t.id }));
      expect(res.status, await res.clone().text()).toBe(202);
      const r = await finish((await res.json()).render.id);
      const out = streams(filePath(r.key!));
      const video = out.streams.find((s) => s.codec_type === "video")!;
      expect([video.width, video.height], c.look).toEqual(c.format === "square" ? [1080, 1080] : [1080, 1920]);
      expect(out.streams.some((s) => s.codec_type === "audio")).toBe(true);
      expect(Number(out.format.duration)).toBeCloseTo(2, 0);
      expect(r).toMatchObject({ width: video.width, height: video.height });
    }
    const dl = await downloadRoute(req(`/x`), params({ id: render((await (await rendersRoute(req("/x"), params({ id: t.id }))).json()).renders[0].id).id }));
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename="ada-lovelace-(vertical|square)-clip\.mp4"$/);
  });

  it("VID-07 a social clip that can't be made says why in the dashboard", async () => {
    const t = await submission(0);
    const { render: queued } = await (await socialRoute(req(`/x`, { json: {} }), params({ id: t.id }))).json();
    fs.rmSync(filePath(t.videoKey!));
    await runDueJobs();
    const res = await renderRoute(req(`/x`), params({ id: queued.id }));
    const { render: failed } = await res.json();
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/missing/);
    expect(failed.downloadUrl).toBeNull();
  });

  it("VID-08 renders a reel: title card, clips cut where chosen with name tags, closing card and our own music", async () => {
    const a = await submission(0, { approve: true, captions: true });
    const b = await submission(0, { approve: true });
    const pending = await submission(0);
    const words = (await (await candidatesRoute(req(`/x`), params({ id: projectId }))).json()).testimonials as { id: string; words: unknown[] | null }[];
    expect(words.map((w) => w.id).sort()).toEqual([a.id, b.id].sort());
    expect(words.find((w) => w.id === a.id)!.words!.length).toBeGreaterThan(3);
    expect(words.find((w) => w.id === b.id)!.words).toBeNull();

    const config = {
      format: "vertical",
      title: "What customers say",
      subtitle: "Acme",
      closingTitle: "Try Acme today",
      closingSubtitle: "acme.example",
      music: true,
      clips: [
        { testimonialId: a.id, startMs: 1000, endMs: 2500 },
        { testimonialId: b.id, startMs: 0, endMs: 2000 },
      ],
    };
    const created = await (await createReelRoute(req(`/x`, { json: { name: "Launch", config } }), params({ id: projectId }))).json();
    const res = await renderReelRoute(req(`/x`, { json: {} }), params({ id: created.reel.id }));
    expect(res.status).toBe(202);
    const r = await finish((await res.json()).render.id);
    const out = streams(filePath(r.key!));
    expect(out.streams.find((s) => s.codec_type === "video")).toMatchObject({ width: 1080, height: 1920 });
    expect(out.streams.some((s) => s.codec_type === "audio")).toBe(true);
    // 3 s + 1.5 s + 2 s + 3 s.
    expect(Number(out.format.duration)).toBeGreaterThan(9);
    expect(Number(out.format.duration)).toBeLessThan(10.5);

    // A clip that isn't approved can't go in; the reel says so and keeps its renders.
    const changed = await putReelRoute(req(`/x`, { method: "PUT", json: { name: "Launch", config: { ...config, clips: [...config.clips, { testimonialId: pending.id, startMs: 0, endMs: 2000 }] } } }), params({ id: created.reel.id }));
    const { reel } = await changed.json();
    expect(reel.warnings).toEqual(["Clip 3: Ada Lovelace’s testimonial isn't approved any more."]);
    expect(reel.renders).toHaveLength(1);
    expect((await renderReelRoute(req(`/x`, { json: {} }), params({ id: created.reel.id }))).status).toBe(400);
    // Deleting the reel deletes its renders' files.
    expect((await deleteReelRoute(req(`/x`, { method: "DELETE" }), params({ id: created.reel.id }))).status).toBe(204);
    expect(fs.existsSync(filePath(r.key!))).toBe(false);
  });

  it("VID-06 with VIDEO_HLS on, an approved video gets 2–3 renditions and a master playlist, public only while the MP4 is", async () => {
    process.env.VIDEO_HLS = "true";
    const main = await storedVideo();
    // A bigger picture than the sample, so the ladder has two rungs.
    const big = path.join(ctx.dir, "big.webm");
    execFileSync("ffmpeg", ["-v", "error", "-i", SAMPLE_WEBM, "-vf", "scale=960:540", "-c:v", "libvpx", "-b:v", "500k", "-c:a", "copy", "-y", big]);
    const stored = await saveFile(big, "video/webm", "video");
    void main;
    const t = createTestimonial(projectId, { name: "Hal", videoKey: stored.key, videoMime: stored.mime });
    await queueVideoProcessing(t.id);
    await runDueJobs();
    expect(getTestimonial(t.id)!.hlsKey).toBeNull(); // pending: no copy yet
    updateTestimonial(t.id, { status: "approved" });
    await new Promise((r) => setTimeout(r, 50));
    await runDueJobs();
    const done = getTestimonial(t.id)!;
    expect(done.hlsKey).toMatch(/^hls\/[0-9a-f-]{36}\/master\.m3u8$/);
    const masterRes = await media(anon(`/api/media/${done.hlsKey}`), params({ key: done.hlsKey!.split("/") }));
    expect(masterRes.status).toBe(200);
    expect(masterRes.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(masterRes.headers.get("cache-control")).toBe("public, no-cache");
    const master = await masterRes.text();
    expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(2);
    expect(master).toContain("RESOLUTION=640x360");
    expect(master).toContain("RESOLUTION=960x540");
    const folder = done.hlsKey!.replace("/master.m3u8", "");
    const v0 = await (await media(anon(`/x`), params({ key: [...folder.split("/"), "v0.m3u8"] }))).text();
    const segment = v0.split("\n").find((l) => l.endsWith(".ts"))!;
    const seg = await media(anon(`/x`), params({ key: [...folder.split("/"), segment] }));
    expect(seg.status).toBe(200);
    expect(seg.headers.get("content-type")).toBe("video/mp2t");
    expect(Number(streams(filePath(`${folder}/${segment}`)).format.duration)).toBeGreaterThan(1);
    // Players list it first; browsers that can't play HLS skip to the MP4.
    expect(toPublic(done).video!.sources.map((s) => s.type)).toEqual(["application/vnd.apple.mpegurl", 'video/mp4; codecs="avc1.640028, mp4a.40.2"', "video/webm"]);

    // Rejected: the playlist and its segments go private at once.
    updateTestimonial(t.id, { status: "rejected" });
    expect((await media(anon(`/x`), params({ key: done.hlsKey!.split("/") }))).status).toBe(404);
    expect((await media(anon(`/x`), params({ key: [...folder.split("/"), segment] }))).status).toBe(404);
    // The team still can.
    expect((await media(req(`/x`), params({ key: done.hlsKey!.split("/") }))).status).toBe(200);

    // A trim makes a new MP4: the old copy stops being served and is replaced.
    updateTestimonial(t.id, { status: "approved" });
    await setTrim(t.id, { startMs: 1000, endMs: null });
    expect(getTestimonial(t.id)!.hlsKey).toBe(done.hlsKey);
    await runDueJobs();
    await runDueJobs();
    const cut = getTestimonial(t.id)!;
    expect(cut.hlsKey).toBeTruthy();
    expect(cut.hlsKey).not.toBe(done.hlsKey);
    expect(fs.existsSync(filePath(done.hlsKey!))).toBe(false);
    expect(fs.existsSync(filePath(`${folder}/${segment}`))).toBe(false);
    expect(isMediaPublic(cut.hlsKey!)).toBe(true);
    // Withdrawn: private again.
    getDb().update(schema.testimonials).set({ withdrawnAt: new Date() }).where(eq(schema.testimonials.id, t.id)).run();
    expect(isMediaPublic(cut.hlsKey!)).toBe(false);
  });

  it("VID-06 is off by default: no copy is made and players list the MP4 first", async () => {
    const t = await submission(0, { approve: true });
    await runDueJobs();
    expect(getTestimonial(t.id)!.hlsKey).toBeNull();
    expect(getDb().select().from(schema.videoRenders).all()).toEqual([]);
    expect(toPublic(getTestimonial(t.id)!).video!.sources[0].type).toMatch(/^video\/mp4/);
  });

  it("FORM-17 the owner's welcome video is converted, plays on the live form with captions, and goes private when the form is paused", async () => {
    const project = getProjectById(projectId)!;
    const form = createForm(projectId, { name: "Second" });
    const { upload, token } = createUpload("video", { projectId, maxBytes: env.maxVideoBytes });
    await appendChunk(upload, 0, new Uint8Array(fs.readFileSync(SAMPLE_WEBM)));
    const res = await formVideosRoute(req(`/api/admin/forms/${form.id}/videos`, { json: { slot: "welcome", upload: { id: upload.id, token } } }), params({ id: form.id }));
    expect(res.status, await res.clone().text()).toBe(201);
    await runDueJobs();
    const row = getDb().select().from(schema.formVideos).all()[0];
    expect(row).toMatchObject({ slot: "welcome", mediaStatus: "ready", formId: form.id });
    const probed = await probe(filePath(row.videoKey!));
    expect(probed.durationMs).toBeGreaterThan(2500);
    // Captions once transcribed (stand-in for the provider).
    getDb().update(schema.formVideos).set({ captionsVtt: CAPTIONS }).where(eq(schema.formVideos.id, row.id)).run();

    const props = runnerProps(project, getDb().select().from(schema.forms).where(eq(schema.forms.id, form.id)).get()!, {});
    expect(props.ownerVideos?.welcome?.sources[0].url).toBe(`/api/media/${row.videoKey}`);
    expect(props.ownerVideos?.welcome?.captionsUrl).toBe(`/api/form-videos/${row.id}/captions`);
    expect(props.ownerVideos?.thank_you).toBeUndefined();
    expect(isMediaPublic(row.videoKey!)).toBe(true);
    expect(isMediaPublic(row.posterKey!)).toBe(true);
    expect((await formVideoCaptions(anon(`/x`), params({ id: row.id }))).status).toBe(200);

    setFormStatus(form.id, "paused");
    expect(isMediaPublic(row.videoKey!)).toBe(false);
    expect((await formVideoCaptions(anon(`/x`), params({ id: row.id }))).status).toBe(404);
    expect((await media(anon(`/x`), params({ key: row.videoKey!.split("/") }))).status).toBe(404);

    // Removing it deletes its files.
    expect((await deleteFormVideoRoute(req(`/x?slot=welcome`, { method: "DELETE" }), params({ id: form.id }))).status).toBe(200);
    expect(fs.existsSync(filePath(row.videoKey!))).toBe(false);
    expect(fs.existsSync(filePath(row.videoOriginalKey!))).toBe(false);
  });
});
