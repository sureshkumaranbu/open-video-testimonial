import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { trimmedTranscript, vttToText } from "./captions";
import { env } from "./env";
import { extractPoster, ffmpegAvailable, probe, queueVideoProcessing, trimOf, waveformPeaks } from "./media";
import { mimeForKey, newKey, removeFiles, saveUpload, storage } from "./storage";
import { getTestimonial, stillUsed, updateTestimonial, type TestimonialWithTags } from "./testimonials";
import { claimUpload, getUpload } from "./uploads";
import { releaseMulticlip } from "./video/renders";

const { testimonials } = schema;

/**
 * The video tools in the inbox drawer (VID-01..04): trim, poster frame,
 * replace and download. Each change goes through updateTestimonial, so it is
 * in the edit history and sends `testimonial.updated`; a trim or a new file
 * also marks the testimonial "edited after consent", like a text edit.
 *
 * Only the testimonial's main video has these tools; videos answering
 * further questions stay as they were recorded (they're owner-only, D13).
 */

export class VideoToolError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The shortest cut we make: anything shorter is almost certainly a slip of the handle. */
export const MIN_TRIM_MS = 1000;
/** Within this of either end counts as the end itself, so dragging a handle home clears the trim. */
const EDGE_MS = 50;

const NEEDS_FFMPEG = "This needs ffmpeg on the server. Install it (see the README) and try again.";

function load(id: string): TestimonialWithTags {
  const t = getTestimonial(id);
  if (!t) throw new VideoToolError(404, "Testimonial not found");
  if (!t.videoKey) throw new VideoToolError(400, "This testimonial has no video");
  return t;
}

/** The original's length. The served MP4's changes with every trim, so trims are checked against this. */
export async function originalDurationMs(t: Pick<TestimonialWithTags, "videoKey" | "videoOriginalKey">): Promise<number | null> {
  const key = t.videoOriginalKey ?? t.videoKey;
  if (!key) return null;
  return storage().withLocalFile(key, async (file) => (fs.existsSync(file) ? (await probe(file)).durationMs : null));
}

export type TrimInput = { startMs: number | null; endMs: number | null };

/**
 * VID-01: keeps [startMs, endMs) of the original (null = from the start / to
 * the end) and re-cuts the served MP4 in a job; the original is kept, so a
 * trim can be changed or undone at any time. The range is checked against
 * the original's real length. Captions keep the original's timeline and are
 * shifted when served; when there are captions, the transcript becomes the
 * text of what the cut keeps (the old one stays in the history).
 */
export async function setTrim(id: string, input: TrimInput, o: { by?: string } = {}): Promise<TestimonialWithTags> {
  const t = load(id);
  if (!(await ffmpegAvailable())) throw new VideoToolError(409, NEEDS_FFMPEG);
  const duration = await originalDurationMs(t);
  if (!duration) throw new VideoToolError(409, "We couldn't read how long the video is. Try “Process again” first.");
  const start = input.startMs ?? 0;
  let end = input.endMs ?? duration;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < 0) {
    throw new VideoToolError(400, "Trim points must be whole milliseconds");
  }
  if (end > duration + EDGE_MS) throw new VideoToolError(400, `The end is after the video ends (${(duration / 1000).toFixed(1)} s)`);
  end = Math.min(end, duration);
  if (end - start < MIN_TRIM_MS) throw new VideoToolError(400, "Keep at least one second of the video");
  const trimStartMs = start > EDGE_MS ? start : null;
  const trimEndMs = end < duration - EDGE_MS ? end : null;
  if (trimStartMs === t.trimStartMs && trimEndMs === t.trimEndMs) return t;

  const trim = trimOf({ trimStartMs, trimEndMs });
  const transcript = t.captionsVtt ? (trim ? trimmedTranscript(t.captionsVtt, trim) : vttToText(t.captionsVtt)) || null : undefined;
  updateTestimonial(id, { trimStartMs, trimEndMs, ...(transcript !== undefined ? { transcript } : {}) }, { by: o.by });
  await queueVideoProcessing(id);
  return getTestimonial(id)!;
}

/** Removes old files nothing else points at (another row, a customer, the image studio). */
async function dropUnused(keys: (string | null)[]) {
  const unused = [...new Set(keys.filter((k): k is string => Boolean(k)))].filter((k) => !stillUsed(k));
  if (unused.length) await removeFiles(unused);
}

/**
 * VID-02: the frame at `atMs` of the served video becomes the poster. The
 * moment is kept, so a later trim takes the poster again from the new cut.
 */
export async function setPosterFrame(id: string, atMs: number, o: { by?: string } = {}): Promise<TestimonialWithTags> {
  const t = load(id);
  if (!(await ffmpegAvailable())) throw new VideoToolError(409, NEEDS_FFMPEG);
  if (t.mediaStatus !== "ready") throw new VideoToolError(409, "Wait for the video to finish processing, then pick the frame");
  if (!Number.isSafeInteger(atMs) || atMs < 0 || (t.videoDurationMs !== null && atMs > t.videoDurationMs)) {
    throw new VideoToolError(400, "Pick a moment inside the video");
  }
  const key = newKey("image", "jpg");
  await fs.promises.mkdir(env.tmpDir, { recursive: true });
  const tmp = path.join(env.tmpDir, `poster-${crypto.randomUUID()}.jpg`);
  try {
    await storage().withLocalFile(t.videoKey!, (file) => extractPoster(file, tmp, t.videoDurationMs, atMs));
    await storage().put(key, { path: tmp, move: true }, "image/jpeg");
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
  // The video may have been re-cut or replaced while the frame was taken.
  const now = getTestimonial(id);
  if (!now || now.videoKey !== t.videoKey) {
    await removeFiles([key]);
    throw new VideoToolError(409, "The video changed meanwhile. Pick the frame again.");
  }
  const updated = updateTestimonial(id, { posterKey: key, posterAtMs: atMs, posterCustom: false }, { by: o.by })!;
  if (now.posterKey !== key) await dropUnused([now.posterKey]);
  return updated;
}

/** VID-02: an uploaded image (PNG, JPEG, WebP or GIF; sniffed and size-capped like any image) becomes the poster. */
export async function setPosterImage(id: string, file: File, o: { by?: string } = {}): Promise<TestimonialWithTags> {
  const t = load(id);
  const stored = await saveUpload(file, "image");
  const updated = updateTestimonial(id, { posterKey: stored.key, posterAtMs: null, posterCustom: true }, { by: o.by });
  if (!updated) {
    await removeFiles([stored.key]);
    throw new VideoToolError(404, "Testimonial not found");
  }
  await dropUnused([t.posterKey]);
  return updated;
}

/** VID-02: back to the default frame (taken again when ffmpeg is there; otherwise no poster). */
export async function resetPoster(id: string, o: { by?: string } = {}): Promise<TestimonialWithTags> {
  const t = load(id);
  if (!t.posterCustom && t.posterAtMs === null) return t;
  const ok = (await ffmpegAvailable()) && t.mediaStatus === "ready";
  let key: string | null = null;
  if (ok) {
    key = newKey("image", "jpg");
    await fs.promises.mkdir(env.tmpDir, { recursive: true });
    const tmp = path.join(env.tmpDir, `poster-${crypto.randomUUID()}.jpg`);
    try {
      await storage().withLocalFile(t.videoKey!, (file) => extractPoster(file, tmp, t.videoDurationMs));
      await storage().put(key, { path: tmp, move: true }, "image/jpeg");
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
  }
  const updated = updateTestimonial(id, { posterKey: key, posterAtMs: null, posterCustom: false }, { by: o.by })!;
  await dropUnused([t.posterKey]);
  return updated;
}

/**
 * VID-03: a finished resumable upload (POST /api/admin/uploads, kind video)
 * becomes the testimonial's video. The trim and picked poster are cleared,
 * the pipeline runs again, and the transcript is made again once it's
 * converted (when a provider is set up). The old files go unless something
 * else still uses them.
 */
export async function replaceVideo(id: string, ref: { id: string; token: string }, o: { by?: string } = {}): Promise<TestimonialWithTags> {
  const t = load(id);
  const upload = getUpload(ref.id, ref.token);
  if (!upload || upload.kind !== "video" || upload.projectId !== t.projectId) {
    throw new VideoToolError(400, "That upload has expired or belongs elsewhere. Choose the file again.");
  }
  const video = await claimUpload(upload, "video");
  if (!getTestimonial(id)) {
    await removeFiles([video.key]);
    throw new VideoToolError(404, "Testimonial not found");
  }
  // Facts about the old file that aren't edits of their own (the history shows the new file).
  getDb()
    .update(testimonials)
    .set({ videoMime: video.mime, videoDurationMs: null, videoWidth: null, videoHeight: null, mediaError: null, transcriptStatus: "none", transcriptError: null })
    .where(eq(testimonials.id, id))
    .run();
  updateTestimonial(
    id,
    {
      videoKey: video.key,
      videoOriginalKey: video.key,
      posterKey: null,
      posterAtMs: null,
      posterCustom: false,
      trimStartMs: null,
      trimEndMs: null,
      transcript: null,
      captionsVtt: null,
    },
    { by: o.by },
  );
  await queueVideoProcessing(id);
  // A multiclip shown as the video (VID-05) is just a multiclip again; the answer it replaced goes too.
  await releaseMulticlip(id);
  await dropUnused([t.videoKey, t.videoOriginalKey, t.posterKey]);
  return getTestimonial(id)!;
}

export const DOWNLOADS = ["original", "mp4"] as const;
export type DownloadKind = (typeof DOWNLOADS)[number];

/** A file name that's safe in a Content-Disposition header: the author's name, letters and digits only. */
export function downloadName(t: Pick<TestimonialWithTags, "authorName">, kind: DownloadKind, key: string) {
  const base =
    t.authorName
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 40) || "testimonial";
  return `${base}-${kind === "original" ? "original" : "video"}.${key.slice(key.lastIndexOf(".") + 1)}`;
}

/** VID-04: the file to download, or null. `mp4` is the converted video (the cut, when trimmed). */
export function downloadFor(t: TestimonialWithTags, kind: DownloadKind): { key: string; mime: string; name: string } | null {
  const key = kind === "original" ? (t.videoOriginalKey ?? t.videoKey) : t.mediaStatus === "ready" ? t.videoKey : null;
  if (!key) return null;
  return { key, mime: mimeForKey(key), name: downloadName(t, kind, key) };
}

/** VID-01: the original's waveform and length for the trim tool. Needs ffmpeg. */
export async function trimInfo(id: string): Promise<{ durationMs: number; peaks: number[]; startMs: number; endMs: number }> {
  const t = load(id);
  if (!(await ffmpegAvailable())) throw new VideoToolError(409, NEEDS_FFMPEG);
  const key = t.videoOriginalKey ?? t.videoKey!;
  const info = await storage().withLocalFile(key, async (file) => {
    if (!fs.existsSync(file)) return null;
    const durationMs = (await probe(file)).durationMs;
    return durationMs ? { durationMs, peaks: await waveformPeaks(file) } : null;
  });
  if (!info) throw new VideoToolError(409, "We couldn't read the video. Try “Process again” first.");
  return { ...info, startMs: t.trimStartMs ?? 0, endMs: t.trimEndMs ?? info.durationMs };
}
