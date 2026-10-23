import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as widget } from "@/app/api/widget/[slug]/route";
import { POST as reprocess } from "@/app/api/admin/testimonials/[id]/reprocess/route";
import { env } from "@/lib/env";
import { runDueJobs } from "@/lib/jobs";
import { probe, queueUnprocessedVideos, queueVideoProcessing, resetFfmpegCheck } from "@/lib/media";
import { saveFile, sniffMime } from "@/lib/storage";
import { createProject, createTestimonial, deleteTestimonial, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, hasFfmpeg, params, SAMPLE_WEBM, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetFfmpegCheck();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.FFMPEG_PATH;
  delete process.env.MEDIA_PROCESSING;
  resetFfmpegCheck();
  ctx.cleanup();
});

async function storeVideo(file: string) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  return saveFile(file, sniffMime(head), "video");
}

async function videoTestimonial(file = SAMPLE_WEBM) {
  const stored = await storeVideo(file);
  const t = createTestimonial(projectId, { name: "Ada", videoKey: stored.key, videoMime: stored.mime });
  return t;
}

const exists = (key: string | null) => Boolean(key) && fs.existsSync(path.join(env.uploadsDir, key!));

describe.skipIf(!hasFfmpeg())("video processing (needs ffmpeg)", () => {
  it("converts to a web-safe MP4 with a poster and keeps the original", async () => {
    const t = await videoTestimonial();
    await queueVideoProcessing(t.id);
    expect(getTestimonial(t.id)!.mediaStatus).toBe("queued");
    await runDueJobs();

    const done = getTestimonial(t.id)!;
    expect(done).toMatchObject({
      mediaStatus: "ready",
      mediaError: null,
      videoMime: "video/mp4",
      videoWidth: 320,
      videoHeight: 240,
      videoOriginalKey: t.videoKey,
    });
    expect(done.videoKey).toMatch(/^videos\/.+\.mp4$/);
    expect(done.posterKey).toMatch(/^images\/.+\.jpg$/);
    expect(done.videoDurationMs).toBeGreaterThan(2500);
    expect(exists(done.videoKey) && exists(done.posterKey) && exists(done.videoOriginalKey)).toBe(true);

    const mp4 = path.join(env.uploadsDir, done.videoKey!);
    const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,pix_fmt", "-of", "csv=p=0", mp4])
      .toString()
      .trim()
      .split("\n");
    expect(streams).toEqual(["h264,yuv420p", "aac"]);
    // Fast-start: the index (moov) comes before the media data (mdat).
    const head = fs.readFileSync(mp4).subarray(0, 64 * 1024).toString("latin1");
    expect(head.indexOf("moov")).toBeGreaterThan(-1);
    expect(head.indexOf("moov")).toBeLessThan(head.indexOf("mdat") === -1 ? Infinity : head.indexOf("mdat"));
    expect(sniffMime(fs.readFileSync(path.join(env.uploadsDir, done.posterKey!)).subarray(0, 16))).toBe("image/jpeg");
  });

  it("keeps portrait videos upright and caps the long side at 1280 px", async () => {
    const tall = path.join(ctx.dir, "tall.webm");
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=10:duration=1",
      "-c:v", "libvpx", "-b:v", "200k", "-y", tall,
    ]);
    const t = await videoTestimonial(tall);
    await queueVideoProcessing(t.id);
    await runDueJobs();
    const done = getTestimonial(t.id)!;
    expect(done.mediaStatus).toBe("ready");
    expect([done.videoWidth, done.videoHeight]).toEqual([720, 1280]);
    const info = await probe(path.join(env.uploadsDir, done.videoKey!));
    expect(info.hasAudio).toBe(false);
  });

  it("publishes the poster and size in the widget feed", async () => {
    const t = await videoTestimonial();
    updateTestimonial(t.id, { status: "approved" });
    await queueVideoProcessing(t.id);
    await runDueJobs();
    const body = await (await widget(new Request("http://localhost/api/widget/acme"), params({ slug: "acme" }))).json();
    expect(body.testimonials[0].video).toMatchObject({
      mime: "video/mp4",
      width: 320,
      height: 240,
      poster: expect.stringMatching(/^\/api\/media\/images\/.+\.jpg$/),
    });
  });

  it("marks broken files as failed and can be retried", async () => {
    const junk = path.join(ctx.dir, "junk.webm");
    fs.writeFileSync(junk, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4096, 7)]));
    const t = await videoTestimonial(junk);
    await queueVideoProcessing(t.id);
    await runDueJobs({ now: () => new Date(Date.now() + 24 * 60 * 60 * 1000) });
    await runDueJobs({ now: () => new Date(Date.now() + 48 * 60 * 60 * 1000) });
    const failed = getTestimonial(t.id)!;
    expect(failed.mediaStatus).toBe("failed");
    expect(failed.mediaError).toMatch(/ffprobe|ffmpeg/);
    expect(failed.videoKey).toBe(t.videoKey); // the original is still served
    expect(fs.readdirSync(path.join(env.uploadsDir, "videos"))).toHaveLength(1); // no half-written MP4 left

    const res = await reprocess(
      new Request(`http://localhost/api/admin/testimonials/${t.id}/reprocess`, {
        method: "POST",
        headers: { ...adminHeaders() },
      }),
      params({ id: t.id }),
    );
    expect(res.status).toBe(200);
    expect(getTestimonial(t.id)!.mediaStatus).toBe("queued");
  });

  it("deleting a testimonial removes the original, the MP4 and the poster", async () => {
    const t = await videoTestimonial();
    await queueVideoProcessing(t.id);
    await runDueJobs();
    const done = getTestimonial(t.id)!;
    await deleteTestimonial(t.id);
    for (const key of [done.videoKey, done.videoOriginalKey, done.posterKey]) expect(exists(key)).toBe(false);
  });

  it("converts videos that were skipped while ffmpeg was missing, once it's there", async () => {
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
    const t = await videoTestimonial();
    await queueVideoProcessing(t.id);
    expect(getTestimonial(t.id)!.mediaStatus).toBe("skipped");
    delete process.env.FFMPEG_PATH; // "installed" without restarting
    expect(await queueUnprocessedVideos()).toBe(1);
    await runDueJobs();
    expect(getTestimonial(t.id)!.mediaStatus).toBe("ready");
  });

  it("queues videos uploaded before the pipeline existed", async () => {
    const t = await videoTestimonial();
    expect(getTestimonial(t.id)!.mediaStatus).toBe("none");
    expect(await queueUnprocessedVideos()).toBe(1);
    expect(getTestimonial(t.id)!.mediaStatus).toBe("queued");
    expect(await queueUnprocessedVideos()).toBe(0);
  });
});

describe("without ffmpeg", () => {
  it("serves the original file and says why", async () => {
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
    const t = await videoTestimonial();
    await queueVideoProcessing(t.id);
    expect(await runDueJobs()).toBe(0);
    expect(getTestimonial(t.id)).toMatchObject({ mediaStatus: "skipped", videoKey: t.videoKey, posterKey: null });
  });

  it("can be turned off with MEDIA_PROCESSING=off", async () => {
    process.env.MEDIA_PROCESSING = "off";
    const t = await videoTestimonial();
    await queueVideoProcessing(t.id);
    expect(getTestimonial(t.id)!.mediaStatus).toBe("skipped");
  });
});
