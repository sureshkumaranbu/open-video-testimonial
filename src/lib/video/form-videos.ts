import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FormVideo, FormVideoSlot } from "@/db/schema";
import { env } from "../env";
import { enqueue, PermanentJobError } from "../jobs";
import { extractAudio, ffmpegAvailable, probe, processVideoTarget } from "../media";
import { mediaUrl, MIME_BY_EXT, removeFiles, storage } from "../storage";
import { stillUsed } from "../testimonials";
import { transcribeFile, transcriptionEnabled } from "../transcribe";
import { claimUpload, getUpload } from "../uploads";

const { formVideos, forms } = schema;

/**
 * FORM-17: the owner's own video on a form's welcome and thank-you pages,
 * recorded with the same recorder visitors use or uploaded. It goes through
 * the same pipeline as a testimonial's video (MP4, poster, captions once
 * transcribed) and is public media while the form is live.
 */
export const FORM_VIDEO_JOB = "video.form-process";
export const FORM_VIDEO_TRANSCRIBE_JOB = "video.form-transcribe";

export class FormVideoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function listFormVideos(formId: string): FormVideo[] {
  return getDb().select().from(formVideos).where(eq(formVideos.formId, formId)).all();
}

export function getFormVideo(id: string): FormVideo | null {
  return getDb().select().from(formVideos).where(eq(formVideos.id, id)).get() ?? null;
}

const PROCESSED_TYPE = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

/** What the form page plays: the MP4 first, the original as a fallback, captions once there are some. */
export type OwnerVideo = {
  id: string;
  sources: { url: string; type: string }[];
  poster: string | null;
  captionsUrl: string | null;
  width: number | null;
  height: number | null;
};

export function toOwnerVideo(v: FormVideo): OwnerVideo | null {
  if (!v.videoKey || !["ready", "skipped"].includes(v.mediaStatus)) return null;
  const sources = [{ url: mediaUrl(v.videoKey)!, type: v.mediaStatus === "ready" ? PROCESSED_TYPE : (v.videoMime ?? "video/webm") }];
  if (v.mediaStatus === "ready" && v.videoOriginalKey && v.videoOriginalKey !== v.videoKey) {
    sources.push({ url: mediaUrl(v.videoOriginalKey)!, type: MIME_BY_EXT[v.videoOriginalKey.split(".").pop() ?? ""] ?? "video/webm" });
  }
  return {
    id: v.id,
    sources,
    poster: mediaUrl(v.posterKey),
    captionsUrl: v.captionsVtt ? `/api/form-videos/${v.id}/captions` : null,
    width: v.videoWidth,
    height: v.videoHeight,
  };
}

export type OwnerVideos = Partial<Record<FormVideoSlot, OwnerVideo>>;

/** The playable owner videos of a form, by page. */
export function ownerVideosOf(formId: string): OwnerVideos {
  const out: OwnerVideos = {};
  for (const v of listFormVideos(formId)) {
    const shown = toOwnerVideo(v);
    if (shown) out[v.slot] = shown;
  }
  return out;
}

/** The builder's view: the state of each slot's video, playable or not. */
export function formVideosToAdmin(formId: string) {
  return listFormVideos(formId).map((v) => ({
    id: v.id,
    slot: v.slot,
    mediaStatus: v.mediaStatus,
    mediaError: v.mediaError,
    transcriptStatus: v.transcriptStatus,
    transcript: v.transcript,
    hasCaptions: Boolean(v.captionsVtt),
    durationMs: v.videoDurationMs,
    video: toOwnerVideo(v),
  }));
}
export type AdminFormVideo = ReturnType<typeof formVideosToAdmin>[number];

async function dropUnused(keys: (string | null)[]) {
  const unused = [...new Set(keys.filter((k): k is string => Boolean(k)))].filter((k) => !stillUsed(k));
  if (unused.length) await removeFiles(unused);
}

/** Converts the video (or marks it served as uploaded without ffmpeg). */
export async function queueFormVideo(id: string) {
  const ok = await ffmpegAvailable();
  getDb().update(formVideos).set({ mediaStatus: ok ? "queued" : "skipped", mediaError: null, updatedAt: new Date() }).where(eq(formVideos.id, id)).run();
  if (ok) enqueue(FORM_VIDEO_JOB, { formVideoId: id }, { maxAttempts: 2 });
}

/**
 * Puts a finished upload (POST /api/admin/uploads, kind video, the form's
 * project) on the form's welcome or thank-you page, replacing what was there.
 */
export async function setFormVideo(formId: string, slot: FormVideoSlot, ref: { id: string; token: string }): Promise<FormVideo> {
  const db = getDb();
  const form = db.select().from(forms).where(eq(forms.id, formId)).get();
  if (!form) throw new FormVideoError(404, "Form not found");
  const upload = getUpload(ref.id, ref.token);
  if (!upload || upload.kind !== "video" || upload.projectId !== form.projectId) {
    throw new FormVideoError(400, "That upload has expired or belongs elsewhere. Choose the file again.");
  }
  const video = await claimUpload(upload, "video");
  const old = db.select().from(formVideos).where(and(eq(formVideos.formId, formId), eq(formVideos.slot, slot))).get();
  const now = new Date();
  const fields = {
    videoKey: video.key,
    videoOriginalKey: video.key,
    videoMime: video.mime,
    posterKey: null,
    videoDurationMs: null,
    videoWidth: null,
    videoHeight: null,
    mediaStatus: "none" as const,
    mediaError: null,
    transcript: null,
    captionsVtt: null,
    transcriptStatus: "none" as const,
    transcriptError: null,
    updatedAt: now,
  };
  let row: FormVideo;
  if (old) {
    row = db.update(formVideos).set(fields).where(eq(formVideos.id, old.id)).returning().get();
  } else {
    if (!db.select({ id: forms.id }).from(forms).where(eq(forms.id, formId)).get()) {
      await removeFiles([video.key]);
      throw new FormVideoError(404, "Form not found");
    }
    row = db.insert(formVideos).values({ id: crypto.randomUUID(), formId, slot, ...fields, createdAt: now }).returning().get();
  }
  await queueFormVideo(row.id);
  if (old) await dropUnused([old.videoKey, old.videoOriginalKey, old.posterKey]);
  return getFormVideo(row.id)!;
}

/** Takes the video off that page and deletes its files. */
export async function removeFormVideo(formId: string, slot: FormVideoSlot): Promise<boolean> {
  const row = getDb().delete(formVideos).where(and(eq(formVideos.formId, formId), eq(formVideos.slot, slot))).returning().get();
  if (!row) return false;
  await dropUnused([row.videoKey, row.videoOriginalKey, row.posterKey]);
  return true;
}

/** Every file of a form's videos, read before the form is deleted (the rows cascade). */
export function formVideoKeys(formId: string): string[] {
  return listFormVideos(formId).flatMap((v) => [v.videoKey, v.videoOriginalKey, v.posterKey].filter((k): k is string => Boolean(k)));
}

/** The job: converts, then transcribes for captions when a provider is set up. */
export async function processFormVideo(id: string, o: { willRetry?: boolean } = {}) {
  await processVideoTarget({ formVideoId: id }, o);
  const v = getFormVideo(id);
  if (v?.mediaStatus === "ready" && v.transcriptStatus === "none" && transcriptionEnabled()) {
    getDb().update(formVideos).set({ transcriptStatus: "queued", transcriptError: null }).where(eq(formVideos.id, id)).run();
    enqueue(FORM_VIDEO_TRANSCRIBE_JOB, { formVideoId: id }, { maxAttempts: 3 });
  }
}

function setVideo(id: string, fields: Partial<typeof formVideos.$inferInsert>) {
  getDb().update(formVideos).set({ ...fields, updatedAt: new Date() }).where(eq(formVideos.id, id)).run();
}

/** Captions for the owner's video, like an answer's (src/lib/transcribe.ts). */
export async function transcribeFormVideo(id: string, o: { willRetry?: boolean } = {}) {
  const row = getFormVideo(id);
  if (!row) return;
  const key = row.videoOriginalKey ?? row.videoKey;
  if (!key) throw new PermanentJobError("This form video has no file");
  if (!(await ffmpegAvailable())) {
    setVideo(id, { transcriptStatus: "failed", transcriptError: "ffmpeg is needed to read the audio" });
    throw new PermanentJobError("ffmpeg is needed to read the audio");
  }
  setVideo(id, { transcriptStatus: "processing", transcriptError: null });
  await fs.promises.mkdir(env.tmpDir, { recursive: true });
  const wav = path.join(/*turbopackIgnore: true*/ env.tmpDir, `audio-${crypto.randomUUID()}.wav`);
  try {
    await storage().withLocalFile(key, async (input) => {
      if (!(await probe(input)).hasAudio) throw new PermanentJobError("The video has no sound to transcribe");
      await extractAudio(input, wav);
    });
    const result = await transcribeFile(wav);
    const latest = getFormVideo(id);
    // Gone, or replaced meanwhile: the new file has its own job.
    if (!latest || (latest.videoOriginalKey ?? latest.videoKey) !== key) return;
    setVideo(id, { transcript: result.transcript || null, captionsVtt: result.vtt, transcriptStatus: "ready", transcriptError: null });
  } catch (err) {
    const retrying = o.willRetry && !(err instanceof PermanentJobError);
    setVideo(id, { transcriptStatus: retrying ? "queued" : "failed", transcriptError: (err as Error).message.slice(0, 500) });
    throw err;
  } finally {
    await fs.promises.rm(wav, { force: true });
  }
}

/** Captions are public while the form is live; the team can always preview them. */
export function formVideoCaptions(id: string, signedIn: boolean): string | null {
  const row = getDb()
    .select({ vtt: formVideos.captionsVtt, status: forms.status })
    .from(formVideos)
    .innerJoin(forms, eq(forms.id, formVideos.formId))
    .where(eq(formVideos.id, id))
    .get();
  if (!row?.vtt || (row.status !== "live" && !signedIn)) return null;
  return row.vtt;
}
