import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { VideoRender } from "@/db/schema";
import { env } from "../env";
import { enqueue, PermanentJobError } from "../jobs";
import { ffmpegAvailable, probe } from "../media";
import { isMediaKey, mimeForKey, removeFiles, storage } from "../storage";
import { getTestimonial, renderFiles } from "../testimonials";
import { runFfmpeg, timeoutFor, withWorkDir } from "./compose";

const { testimonials, videoRenders } = schema;

/**
 * VID-06: an adaptive-streaming copy of an approved testimonial's video, made
 * when VIDEO_HLS=true. Two or three renditions (360p, 540p, 720p, never
 * bigger than the MP4) cut into 4-second MPEG-TS segments, with a master
 * playlist, stored under `hls/<uuid>/`. Players list it first and only
 * browsers that play HLS themselves (Safari) take it; widget.js gains nothing.
 *
 * Its files are public exactly while the MP4 is (src/lib/testimonials.ts
 * publicMediaQuery): approved and not withdrawn. testimonials.hls_key points
 * at the master playlist only while it was made from the current video_key;
 * any new video clears it, and the next job replaces the old copy.
 */
export const HLS_JOB = "video.hls";

/** The longest video given an HLS copy (a long one costs a lot of CPU and storage for little gain). */
export const MAX_HLS_MS = 30 * 60_000;

/** The renditions, by the short side of the picture: [short side, video kbit/s, audio kbit/s]. */
const LADDER: [number, number, number][] = [
  [360, 800, 96],
  [540, 1400, 128],
  [720, 2800, 128],
];

/** The renditions for a picture of this size: the ladder's rungs it can fill, or one at its own size. */
export function hlsLadder(width: number, height: number): { w: number; h: number; kbps: number; audioKbps: number }[] {
  const short = Math.min(width, height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const size = (s: number) => (width >= height ? { w: even((width * s) / height), h: even(s) } : { w: even(s), h: even((height * s) / width) });
  const rungs = LADDER.filter(([s]) => s <= short);
  if (!rungs.length) return [{ ...size(short), kbps: 600, audioKbps: 96 }];
  return rungs.map(([s, kbps, audioKbps]) => ({ ...size(s), kbps, audioKbps }));
}

/** The names ffmpeg writes, and nothing else: anything unexpected fails the job. */
const FILE_RE = /^(master\.m3u8|v[0-9]\.m3u8|v[0-9]_[0-9]{5}\.ts)$/;

/** Whether this testimonial should have an HLS copy now. */
function wanted(t: { status: string; withdrawnAt: Date | null; mediaStatus: string; videoKey: string | null; videoDurationMs: number | null }) {
  return env.videoHls && t.status === "approved" && !t.withdrawnAt && t.mediaStatus === "ready" && Boolean(t.videoKey) && (t.videoDurationMs ?? 0) <= MAX_HLS_MS;
}

async function dropRenders(rows: VideoRender[]) {
  if (!rows.length) return;
  getDb()
    .delete(videoRenders)
    .where(inArray(videoRenders.id, rows.map((r) => r.id)))
    .run();
  await removeFiles(rows.flatMap((r) => renderFiles(r.files)));
}

/**
 * Brings a testimonial's HLS copy up to date: drops copies made from an
 * older video, and queues a new one when it's wanted and missing. Called
 * after a video is converted, when a testimonial is approved, and hourly.
 */
export async function refreshHls(testimonialId: string): Promise<VideoRender | null> {
  const db = getDb();
  const t = db.select().from(testimonials).where(eq(testimonials.id, testimonialId)).get();
  if (!t) return null;
  const rows = db.select().from(videoRenders).where(and(eq(videoRenders.testimonialId, t.id), eq(videoRenders.kind, "hls"))).all();
  const stale = rows.filter((r) => r.sourceKey !== t.videoKey && r.status !== "processing");
  await dropRenders(stale);
  if (!wanted(t) || !(await ffmpegAvailable())) return null;
  const current = rows.find((r) => r.sourceKey === t.videoKey);
  if (current) {
    // A copy made earlier that lost its pointer (the video was re-cut and back, or a restore) is pointed at again.
    if (current.status === "ready" && t.hlsKey !== current.key) db.update(testimonials).set({ hlsKey: current.key }).where(eq(testimonials.id, t.id)).run();
    return current;
  }
  const now = new Date();
  const row = db
    .insert(videoRenders)
    .values({ id: crypto.randomUUID(), projectId: t.projectId, testimonialId: t.id, kind: "hls", sourceKey: t.videoKey, createdAt: now, updatedAt: now })
    .returning()
    .get();
  enqueue(HLS_JOB, { renderId: row.id }, { maxAttempts: 2 });
  return row;
}

/** Hourly, with VIDEO_HLS on: approved, converted videos that have no copy yet (a few at a time). */
export async function backfillHls(limit = 20) {
  if (!env.videoHls || !(await ffmpegAvailable())) return 0;
  const rows = getDb()
    .select({ id: testimonials.id })
    .from(testimonials)
    .where(and(eq(testimonials.status, "approved"), isNull(testimonials.withdrawnAt), eq(testimonials.mediaStatus, "ready"), isNull(testimonials.hlsKey)))
    .limit(limit * 4)
    .all();
  let queued = 0;
  for (const r of rows) {
    if (queued >= limit) break;
    const pending = getDb()
      .select({ id: videoRenders.id })
      .from(videoRenders)
      .where(and(eq(videoRenders.testimonialId, r.id), eq(videoRenders.kind, "hls"), ne(videoRenders.status, "ready")))
      .get();
    if (pending) continue;
    if (await refreshHls(r.id)) queued++;
  }
  return queued;
}

function setRow(id: string, fields: Partial<typeof videoRenders.$inferInsert>) {
  getDb().update(videoRenders).set({ ...fields, updatedAt: new Date() }).where(eq(videoRenders.id, id)).run();
}

/** Segments ffmpeg with one run: every rendition from the same decode, keyframes every 4 s so they line up. */
async function segment(dir: string, input: string, width: number, height: number, hasAudio: boolean, durationMs: number) {
  const ladder = hlsLadder(width, height);
  const split = `[0:v]split=${ladder.length}${ladder.map((_, i) => `[s${i}]`).join("")}`;
  const scales = ladder.map((r, i) => `[s${i}]scale=${r.w}:${r.h},setsar=1[v${i}]`);
  const maps = ladder.flatMap((r, i) => [
    "-map", `[v${i}]`,
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    `-b:v:${i}`, `${r.kbps}k`, `-maxrate:v:${i}`, `${Math.round(r.kbps * 1.2)}k`, `-bufsize:v:${i}`, `${r.kbps * 2}k`,
    ...(hasAudio ? [`-b:a:${i}`, `${r.audioKbps}k`] : []),
  ]);
  const streamMap = ladder.map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(" ");
  await runFfmpeg(
    [
      "-protocol_whitelist", "file", "-i", input,
      "-filter_complex", [split, ...scales].join(";"),
      ...maps,
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced*4)",
      ...(hasAudio ? ["-c:a", "aac", "-ac", "2", "-ar", "48000"] : []),
      "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
      "-master_pl_name", "master.m3u8", "-hls_segment_filename", "v%v_%05d.ts", "-var_stream_map", streamMap,
      "v%v.m3u8",
    ],
    { cwd: dir, timeoutMs: timeoutFor(durationMs * ladder.length) },
  );
}

/** The job: makes the copy from the current MP4, stores its files, and points the testimonial at it. */
export async function makeHls(renderId: string) {
  const db = getDb();
  const r = db.select().from(videoRenders).where(eq(videoRenders.id, renderId)).get();
  if (!r || r.kind !== "hls" || r.status === "ready") return;
  const t = getTestimonial(r.testimonialId!);
  if (!t || t.videoKey !== r.sourceKey || !t.videoKey) {
    await dropRenders([r]);
    return;
  }
  setRow(r.id, { status: "processing", error: null });
  const folder = `hls/${crypto.randomUUID()}`;
  const stored: string[] = [];
  try {
    const result = await withWorkDir(async (dir) => {
      const out = path.join(/*turbopackIgnore: true*/ dir, "out");
      await fs.promises.mkdir(out);
      const info = await storage().withLocalFile(t.videoKey!, async (file) => {
        if (!fs.existsSync(file)) throw new PermanentJobError("The video file is missing");
        const info = await probe(file);
        if (!info.width || !info.height || !info.durationMs) throw new PermanentJobError("We couldn't read the video");
        if (info.durationMs > MAX_HLS_MS) throw new PermanentJobError(`Videos over ${MAX_HLS_MS / 60000} minutes get no streaming copy`);
        await segment(out, file, info.width, info.height, info.hasAudio, info.durationMs);
        return info;
      });
      const names = (await fs.promises.readdir(out)).sort();
      if (!names.includes("master.m3u8") || names.some((n) => !FILE_RE.test(n))) throw new PermanentJobError("ffmpeg wrote unexpected files");
      let size = 0;
      // Segments first and the master playlist last, so a half-stored copy is never playable.
      for (const name of [...names.filter((n) => n !== "master.m3u8"), "master.m3u8"]) {
        const key = `${folder}/${name}`;
        if (!isMediaKey(key)) throw new PermanentJobError("Invalid HLS file name");
        const res = await storage().put(key, { path: path.join(/*turbopackIgnore: true*/ out, name), move: true }, mimeForKey(key));
        stored.push(key);
        size += res.size;
      }
      return { info, size };
    });
    const master = `${folder}/master.m3u8`;
    // Only if the video is still the one this was made from.
    const pointed = db
      .update(testimonials)
      .set({ hlsKey: master })
      .where(and(eq(testimonials.id, t.id), eq(testimonials.videoKey, r.sourceKey!)))
      .returning({ id: testimonials.id })
      .get();
    if (!pointed || !db.select({ id: videoRenders.id }).from(videoRenders).where(eq(videoRenders.id, r.id)).get()) {
      await removeFiles(stored);
      db.delete(videoRenders).where(eq(videoRenders.id, r.id)).run();
      return;
    }
    setRow(r.id, {
      status: "ready",
      key: master,
      files: JSON.stringify(stored),
      durationMs: result.info.durationMs,
      width: result.info.width,
      height: result.info.height,
      sizeBytes: result.size,
    });
    // Older copies of this testimonial (made from earlier videos) go now.
    const older = db
      .select()
      .from(videoRenders)
      .where(and(eq(videoRenders.testimonialId, t.id), eq(videoRenders.kind, "hls"), ne(videoRenders.id, r.id)))
      .all()
      .filter((x) => x.status !== "processing");
    await dropRenders(older);
  } catch (err) {
    await removeFiles(stored);
    if (db.select({ id: videoRenders.id }).from(videoRenders).where(eq(videoRenders.id, r.id)).get()) {
      setRow(r.id, { status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
    throw err;
  }
}
