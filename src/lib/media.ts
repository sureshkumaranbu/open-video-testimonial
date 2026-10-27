import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "./env";
import { enqueue, PermanentJobError } from "./jobs";
import { newKey, storage } from "./storage";

const { testimonials, answers } = schema;

/**
 * The media pipeline. After a video is stored, a job converts it with ffmpeg
 * into an MP4 (H.264/AAC, at most 1280 px on the long side, fast-start) that
 * every browser can play, and grabs a poster frame. The original is kept.
 * Without ffmpeg the original file is served as-is.
 */
export const PROCESS_VIDEO_JOB = "media.process";

const MAX_SIDE = 1280;

function run(bin: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || err.message).trim().split("\n").slice(-3).join(" ");
          reject(new Error(`${bin} failed: ${detail}`));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

let available: Promise<boolean> | null = null;

/** Whether ffmpeg and ffprobe can be run. Cached for the life of the process. */
export function ffmpegAvailable() {
  if (!env.mediaProcessing) return Promise.resolve(false);
  // Only a success is remembered, so installing ffmpeg later works without a restart.
  available ??= Promise.all([
    run(env.ffmpegPath, ["-hide_banner", "-version"], 10_000),
    run(env.ffprobePath, ["-hide_banner", "-version"], 10_000),
  ]).then(
    () => true,
    () => {
      available = null;
      return false;
    },
  );
  return available;
}

/** Test helper. */
export function resetFfmpegCheck() {
  available = null;
}

// Only read local files; stops crafted playlists from pulling in other files or URLs.
const SAFE_INPUT = ["-protocol_whitelist", "file"];

export interface ProbeResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<ProbeResult> {
  const out = await run(
    env.ffprobePath,
    [...SAFE_INPUT, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
    60_000,
  );
  const data = JSON.parse(out) as {
    streams?: {
      codec_type?: string;
      width?: number;
      height?: number;
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
    format?: { duration?: string };
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const rotation = Math.abs(
    Number(video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0),
  );
  const swap = rotation === 90 || rotation === 270;
  const duration = Number(data.format?.duration);
  return {
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
    width: (swap ? video?.height : video?.width) ?? null,
    height: (swap ? video?.width : video?.height) ?? null,
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
  };
}

const threads = String(Math.max(1, Math.min(os.cpus().length - 1, 4)));

/**
 * A time for an ffmpeg argument, from milliseconds we validated ourselves.
 * Only a non-negative safe integer gets through, so no string from a request
 * ever reaches the command line.
 */
export function ffmpegSeconds(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error(`Invalid time: ${ms}`);
  return (ms / 1000).toFixed(3);
}

/** VID-01: the part of the original to keep, in ms (end null = to the end). */
export type TrimRange = { startMs: number; endMs: number | null };
const fit = `scale=w='min(${MAX_SIDE},iw)':h='min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;

export async function transcodeToMp4(input: string, output: string, trim: TrimRange | null = null) {
  // Seeking before -i while re-encoding is frame-accurate, and much faster than decoding the skipped part.
  const cut = trim
    ? {
        before: trim.startMs > 0 ? ["-ss", ffmpegSeconds(trim.startMs)] : [],
        after: trim.endMs !== null ? ["-t", ffmpegSeconds(trim.endMs - trim.startMs)] : [],
      }
    : { before: [], after: [] };
  await run(
    env.ffmpegPath,
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", ...SAFE_INPUT,
      ...cut.before,
      "-i", input,
      ...cut.after,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", fit,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "-threads", threads,
      "-y", output,
    ],
    30 * 60 * 1000,
  );
}

/**
 * Grabs one frame as a JPEG. `atMs` is the frame the owner picked (VID-02),
 * kept inside the video; without it, a frame one second in, which usually
 * beats the first frame (people blink, cameras adjust).
 */
export async function extractPoster(input: string, output: string, durationMs: number | null, atMs: number | null = null) {
  const at =
    atMs !== null
      ? Math.max(0, Math.min(atMs, durationMs ? durationMs - 100 : atMs))
      : Math.round(durationMs ? Math.min(1000, durationMs / 2) : 0);
  await run(
    env.ffmpegPath,
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", ...SAFE_INPUT,
      "-ss", ffmpegSeconds(Math.round(at)), "-i", input,
      "-frames:v", "1", "-vf", fit, "-q:v", "3",
      "-y", output,
    ],
    2 * 60 * 1000,
  );
}

/** Extracts 16 kHz mono WAV audio, the input format speech-to-text models expect. */
export async function extractAudio(input: string, output: string) {
  await run(
    env.ffmpegPath,
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", ...SAFE_INPUT,
      "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
      "-y", output,
    ],
    15 * 60 * 1000,
  );
}

/** Samples per second read for a waveform: plenty for a few hundred bars, small for a long video. */
const WAVE_RATE = 2000;

/**
 * VID-01: loudness peaks across the file, `bars` values from 0 to 1, for the
 * trim tool's waveform. Silent or soundless videos give all zeros.
 */
export async function waveformPeaks(input: string, bars = 240): Promise<number[]> {
  if (!Number.isSafeInteger(bars) || bars < 1 || bars > 2000) throw new Error("Invalid bar count");
  if (!(await probe(input)).hasAudio) return new Array(bars).fill(0);
  await fs.promises.mkdir(env.tmpDir, { recursive: true });
  const raw = path.join(env.tmpDir, `wave-${crypto.randomUUID()}.pcm`);
  try {
    await run(
      env.ffmpegPath,
      ["-nostdin", "-hide_banner", "-loglevel", "error", ...SAFE_INPUT, "-i", input, "-vn", "-ac", "1", "-ar", String(WAVE_RATE), "-f", "s16le", "-y", raw],
      5 * 60 * 1000,
    );
    const pcm = await fs.promises.readFile(raw);
    const samples = Math.floor(pcm.byteLength / 2);
    const per = Math.max(1, Math.floor(samples / bars));
    const peaks = new Array<number>(bars).fill(0);
    for (let b = 0; b < bars; b++) {
      let max = 0;
      for (let i = b * per; i < Math.min(samples, (b + 1) * per); i++) max = Math.max(max, Math.abs(pcm.readInt16LE(i * 2)));
      peaks[b] = max;
    }
    const top = Math.max(...peaks, 1);
    return peaks.map((p) => Math.round((p / top) * 100) / 100);
  } finally {
    await fs.promises.rm(raw, { force: true });
  }
}

/**
 * Queues processing for a testimonial's video, or marks it skipped without
 * ffmpeg. `autoApprove` applies the project's auto-approve rule once it's done;
 * only new submissions ask for that.
 */
export async function queueVideoProcessing(testimonialId: string, opts: { autoApprove?: boolean } = {}) {
  const ok = await ffmpegAvailable();
  getDb()
    .update(testimonials)
    .set({ mediaStatus: ok ? "queued" : "skipped", mediaError: null })
    .where(eq(testimonials.id, testimonialId))
    .run();
  if (ok) enqueue(PROCESS_VIDEO_JOB, { testimonialId, ...(opts.autoApprove ? { autoApprove: true } : {}) }, { maxAttempts: 2 });
}

/** What a conversion produced, already in storage. */
type Converted = {
  mp4Key: string;
  /** null when the poster was kept (an uploaded one, VID-02). */
  posterKey: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

/**
 * Converts a stored original to MP4 plus a poster and puts both in storage.
 * ffmpeg writes to DATA_DIR/tmp; the results are then put in storage (a
 * rename on local disk, an upload on S3), so nothing half-written is stored.
 * On failure nothing new is left behind. `trim` cuts the MP4 (VID-01);
 * `posterAtMs` picks the poster's frame and `keepPoster` makes none (VID-02).
 */
async function convertStored(
  originalKey: string,
  o: { trim?: TrimRange | null; posterAtMs?: number | null; keepPoster?: boolean } = {},
): Promise<Converted> {
  const mp4Key = newKey("video", "mp4");
  const posterKey = o.keepPoster ? null : newKey("image", "jpg");
  const mp4 = path.join(env.tmpDir, `convert-${crypto.randomUUID()}.mp4`);
  const poster = path.join(env.tmpDir, `poster-${crypto.randomUUID()}.jpg`);
  const stored: string[] = [];
  try {
    const store = storage();
    await fs.promises.mkdir(env.tmpDir, { recursive: true });
    const { info, out } = await store.withLocalFile(originalKey, async (input) => {
      if (!fs.existsSync(input)) throw new PermanentJobError("The original video file is missing");
      const info = await probe(input);
      await transcodeToMp4(input, mp4, o.trim ?? null);
      const out = await probe(mp4);
      if (posterKey) await extractPoster(mp4, poster, out.durationMs ?? info.durationMs, o.posterAtMs ?? null);
      return { info, out };
    });
    await store.put(mp4Key, { path: mp4, move: true }, "video/mp4");
    stored.push(mp4Key);
    if (posterKey) {
      await store.put(posterKey, { path: poster, move: true }, "image/jpeg");
      stored.push(posterKey);
    }
    // A cut keeps no duration of the original's.
    const durationMs = out.durationMs ?? (o.trim ? null : info.durationMs);
    return { mp4Key, posterKey, durationMs, width: out.width, height: out.height };
  } catch (err) {
    await Promise.all([mp4, poster].map((f) => fs.promises.rm(f, { force: true })));
    await Promise.all(stored.map((k) => storage().remove(k).catch(() => undefined)));
    throw err;
  }
}

/** The row a video belongs to: a testimonial's main video, or the answer to a further question (D13: answers stay private). */
export type VideoTarget = { testimonialId: string } | { answerId: string };

type VideoRow = {
  videoKey: string | null;
  videoOriginalKey: string | null;
  posterKey: string | null;
  // Testimonials only (answers have no trim or picked poster).
  trimStartMs?: number | null;
  trimEndMs?: number | null;
  posterAtMs?: number | null;
  posterCustom?: boolean;
};

/** The row's trim (VID-01), or null when the whole original is served. */
export function trimOf(row: { trimStartMs?: number | null; trimEndMs?: number | null }): TrimRange | null {
  const startMs = row.trimStartMs ?? 0;
  const endMs = row.trimEndMs ?? null;
  return startMs > 0 || endMs !== null ? { startMs, endMs } : null;
}
type VideoFields = Partial<typeof testimonials.$inferInsert & typeof answers.$inferInsert>;

function targetRow(t: VideoTarget): { read: () => VideoRow | null; write: (f: VideoFields) => void } {
  const db = getDb();
  if ("answerId" in t) {
    return {
      read: () => db.select().from(answers).where(eq(answers.id, t.answerId)).get() ?? null,
      write: (f) => void db.update(answers).set({ ...f, updatedAt: new Date() }).where(eq(answers.id, t.answerId)).run(),
    };
  }
  return {
    read: () => db.select().from(testimonials).where(eq(testimonials.id, t.testimonialId)).get() ?? null,
    write: (f) => void db.update(testimonials).set(f).where(eq(testimonials.id, t.testimonialId)).run(),
  };
}

/** Converts a testimonial's or an answer's video. `willRetry` keeps the status at "queued" when the job queue will try again. */
export async function processVideoTarget(target: VideoTarget, opts: { willRetry?: boolean } = {}) {
  const row = targetRow(target);
  const current = row.read();
  if (!current) return; // deleted while queued
  const originalKey = current.videoOriginalKey ?? current.videoKey;
  if (!originalKey) return;
  if (!(await ffmpegAvailable())) {
    row.write({ mediaStatus: "skipped" });
    return;
  }
  row.write({ mediaStatus: "processing" });
  // An uploaded poster stays; a picked frame is taken again from the new cut.
  const keepPoster = Boolean(current.posterCustom && current.posterKey);
  let converted: Converted;
  try {
    converted = await convertStored(originalKey, { trim: trimOf(current), posterAtMs: current.posterAtMs ?? null, keepPoster });
  } catch (err) {
    const retrying = opts.willRetry && !(err instanceof PermanentJobError);
    if (row.read()) row.write({ mediaStatus: retrying ? "queued" : "failed", mediaError: (err as Error).message.slice(0, 500) });
    throw err;
  }
  // The row may have been deleted while ffmpeg ran or the files went up.
  const now = row.read();
  const made = [converted.mp4Key, converted.posterKey].filter((k): k is string => Boolean(k));
  if (!now) {
    await Promise.all(made.map((k) => storage().remove(k).catch(() => undefined)));
    throw new PermanentJobError("Deleted during processing");
  }
  // Replaced while ffmpeg ran (VID-03): this result is for a file that's gone; the new file's own job follows.
  if ((now.videoOriginalKey ?? now.videoKey) !== originalKey) {
    await Promise.all(made.map((k) => storage().remove(k).catch(() => undefined)));
    return;
  }
  const keep = (k: string | null) => k === originalKey || (keepPoster && k === now.posterKey);
  const replaced = [now.videoKey, now.posterKey].filter((k): k is string => Boolean(k) && !keep(k));
  row.write({
    videoOriginalKey: originalKey,
    videoKey: converted.mp4Key,
    videoMime: "video/mp4",
    ...(converted.posterKey ? { posterKey: converted.posterKey } : {}),
    videoDurationMs: converted.durationMs,
    videoWidth: converted.width,
    videoHeight: converted.height,
    mediaStatus: "ready",
    mediaError: null,
  });
  await Promise.all(replaced.map((k) => storage().remove(k)));
}

/** `willRetry` keeps the status at "queued" when the job queue will try again. */
export async function processVideo(testimonialId: string, opts: { willRetry?: boolean } = {}) {
  return processVideoTarget({ testimonialId }, opts);
}

export const PROCESS_ANSWER_VIDEO_JOB = "media.process-answer";

/** Queues an answer's video like a testimonial's; without ffmpeg it's served as uploaded. */
export async function queueAnswerVideo(answerId: string, opts: { autoApprove?: boolean } = {}) {
  const ok = await ffmpegAvailable();
  getDb()
    .update(answers)
    .set({ mediaStatus: ok ? "queued" : "skipped", mediaError: null })
    .where(eq(answers.id, answerId))
    .run();
  if (ok) enqueue(PROCESS_ANSWER_VIDEO_JOB, { answerId, ...(opts.autoApprove ? { autoApprove: true } : {}) }, { maxAttempts: 2 });
}

/**
 * Picks up videos that were uploaded before the pipeline existed (or while
 * ffmpeg was missing) so upgrading an instance converts them too.
 */
export async function queueUnprocessedVideos() {
  if (!(await ffmpegAvailable())) return 0;
  const rows = getDb()
    .select({ id: testimonials.id })
    .from(testimonials)
    .where(and(isNotNull(testimonials.videoKey), inArray(testimonials.mediaStatus, ["none", "skipped"])))
    .all();
  for (const r of rows) await queueVideoProcessing(r.id);
  return rows.length;
}
