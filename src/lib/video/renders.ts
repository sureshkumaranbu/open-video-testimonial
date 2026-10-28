import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Answer, Project, RenderKind, VideoRender } from "@/db/schema";
import { trimVtt } from "../captions";
import { normalizeHex } from "../contrast";
import { enqueue, PermanentJobError } from "../jobs";
import { ffmpegAvailable, probe, queueVideoProcessing, trimOf, type ProbeResult } from "../media";
import { parseBrand } from "../projects";
import { mediaUrl, newKey, removeFiles, storage } from "../storage";
import { getProjectById, getTestimonial, renderFiles, stillUsed, updateTestimonial, type TestimonialWithTags } from "../testimonials";
import { addMusic, cardSegment, joinSegments, renderSegment, segName, withWorkDir, type Brand, type Canvas, type Segment } from "./compose";
import { CANVAS, MAX_SOCIAL_MS } from "./looks";
import { MAX_REEL_MS, REEL_CARD_MS, reelConfigSchema, reelLengthMs, socialOptionsSchema, type ReelConfig, type SocialOptions } from "./reel-config";
import { reelClipLayers, socialLook, type Person } from "./social";
import { wordsBetween, wordsFromText, wordsFromVtt, type Word } from "./words";

const { videoRenders, answers, highlightReels } = schema;

/**
 * M16's renders: multiclips (VID-05), social clips (VID-07) and highlight
 * reels (VID-08). Asking for one stores a row and queues a job; the job
 * reads the current files, builds the video in a scratch folder
 * (./compose.ts) and stores one MP4. Every result is owner-only media until
 * the owner makes a multiclip the testimonial's video.
 */
export const RENDER_JOB = "video.render";

export class RenderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** VID-05: the longest multiclip, cards included. */
export const MAX_MULTICLIP_MS = 20 * 60_000;
/** Renders being made at once per project; more wait for these to finish. */
export const MAX_ACTIVE_RENDERS = 3;
/** The largest file a render may leave in storage. */
const MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;
/** Older social clips of a testimonial beyond this many are deleted when a new one is ready. */
const KEEP_SOCIAL = 6;
/** Renders kept per reel. */
const KEEP_REEL = 3;
const QUESTION_CARD_MS = 2500;

const NEEDS_FFMPEG = "This needs ffmpeg on the server. Install it (see the README) and try again.";

/** The brand kit's main colour, else the project's accent colour. */
export function brandColorOf(project: Pick<Project, "brand" | "accentColor">) {
  return normalizeHex(parseBrand(project.brand).colors.primary ?? "") ?? normalizeHex(project.accentColor) ?? "#0f766e";
}

export function parseOptions(r: Pick<VideoRender, "options">): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(r.options || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The dashboard's view of a render. */
export function renderToAdmin(r: VideoRender) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    error: r.error,
    options: parseOptions(r),
    url: r.status === "ready" ? mediaUrl(r.key) : null,
    downloadUrl: r.status === "ready" ? `/api/admin/renders/${r.id}/download` : null,
    durationMs: r.durationMs,
    width: r.width,
    height: r.height,
    sizeBytes: r.sizeBytes,
    usedAsVideo: r.usedAsVideo,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type AdminRender = ReturnType<typeof renderToAdmin>;

export function getRender(id: string): VideoRender | null {
  return getDb().select().from(videoRenders).where(eq(videoRenders.id, id)).get() ?? null;
}

/** A testimonial's multiclips and social clips, newest first (its HLS copy isn't listed). */
export function listTestimonialRenders(testimonialId: string): VideoRender[] {
  return getDb()
    .select()
    .from(videoRenders)
    .where(and(eq(videoRenders.testimonialId, testimonialId), ne(videoRenders.kind, "hls")))
    .orderBy(desc(videoRenders.createdAt))
    .all();
}

const inFlight = ["queued", "processing"] as const;

/** One render of a kind per testimonial or reel at a time, and a few per project. */
function checkQueue(projectId: string, same: { testimonialId?: string; reelId?: string; kind: RenderKind }) {
  const db = getDb();
  const busy = db
    .select({ id: videoRenders.id, testimonialId: videoRenders.testimonialId, reelId: videoRenders.reelId, kind: videoRenders.kind })
    .from(videoRenders)
    .where(and(eq(videoRenders.projectId, projectId), inArray(videoRenders.status, [...inFlight]), ne(videoRenders.kind, "hls")))
    .all();
  if (busy.some((b) => b.kind === same.kind && ((same.testimonialId && b.testimonialId === same.testimonialId) || (same.reelId && b.reelId === same.reelId)))) {
    throw new RenderError(409, "One is already being made. Wait for it to finish.");
  }
  if (busy.length >= MAX_ACTIVE_RENDERS) throw new RenderError(429, `${MAX_ACTIVE_RENDERS} videos are being made for this project already. Try again when one has finished.`);
}

function queue(values: { projectId: string; testimonialId?: string | null; reelId?: string | null; kind: RenderKind; options: object; by?: string }): VideoRender {
  const now = new Date();
  const row = getDb()
    .insert(videoRenders)
    .values({
      id: crypto.randomUUID(),
      projectId: values.projectId,
      testimonialId: values.testimonialId ?? null,
      reelId: values.reelId ?? null,
      kind: values.kind,
      options: JSON.stringify(values.options),
      createdBy: values.by ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  // A render is deterministic: a second attempt would fail the same way, so failures show at once.
  enqueue(RENDER_JOB, { renderId: row.id }, { maxAttempts: 1 });
  return row;
}

// ------------------------------------------------------------------ sources

type Clip = { key: string; title: string };

/** The video to use for a row: the converted MP4 once it's ready, else the file as uploaded. */
const playable = (r: { videoKey: string | null; videoOriginalKey: string | null; mediaStatus: string }) =>
  r.mediaStatus === "ready" ? r.videoKey : (r.videoOriginalKey ?? r.videoKey);

/** The multiclip this testimonial shows as its video (VID-05), if any. */
export function multiclipInUse(t: Pick<TestimonialWithTags, "id" | "videoOriginalKey" | "videoKey">): VideoRender | null {
  const row = getDb()
    .select()
    .from(videoRenders)
    .where(and(eq(videoRenders.testimonialId, t.id), eq(videoRenders.kind, "multiclip"), eq(videoRenders.usedAsVideo, true)))
    .get();
  return row && row.key && (t.videoOriginalKey ?? t.videoKey) === row.key ? row : null;
}

/**
 * VID-05: the videos a multiclip joins, in the order they were asked: the
 * main answer, then each further question's. While a multiclip is the
 * testimonial's video, the main answer is the file it replaced.
 */
export function multiclipSources(t: TestimonialWithTags): Clip[] {
  const used = multiclipInUse(t);
  const main = used?.replacedKey ?? playable(t);
  const rest = getDb()
    .select()
    .from(answers)
    .where(eq(answers.testimonialId, t.id))
    .orderBy(asc(answers.position))
    .all()
    .filter((a: Answer) => a.videoKey);
  return [
    ...(main ? [{ key: main, title: t.primaryQuestion || "In their words" }] : []),
    ...rest.map((a) => ({ key: playable(a)!, title: a.questionTitle })),
  ];
}

async function withLocalFiles<T>(keys: string[], fn: (paths: string[]) => Promise<T>, acc: string[] = []): Promise<T> {
  if (acc.length === keys.length) return fn(acc);
  return storage().withLocalFile(keys[acc.length], async (file) => {
    if (!fs.existsSync(file)) throw new PermanentJobError("A video file this needs is missing");
    return withLocalFiles(keys, fn, [...acc, file]);
  });
}

/** The project's logo on local disk, if it has one we can read. */
async function withLogo<T>(project: Project, fn: (logo: string | null) => Promise<T>): Promise<T> {
  if (!project.logoKey) return fn(null);
  return storage().withLocalFile(project.logoKey, (file) => fn(fs.existsSync(file) ? file : null));
}

function personOf(t: TestimonialWithTags): Person {
  return { name: t.authorName, detail: [t.authorTitle, t.authorCompany].filter(Boolean).join(", ") || null };
}

/** The served video's words with times (captions follow a trim, VID-01); a transcript alone is spread evenly. */
function wordsOf(t: TestimonialWithTags, durationMs: number): Word[] {
  if (t.captionsVtt) return wordsFromVtt(trimVtt(t.captionsVtt, trimOf(t)));
  if (t.transcript) return wordsFromText(t.transcript, durationMs / 1000);
  return [];
}

const probed = async (file: string): Promise<ProbeResult & { durationMs: number }> => {
  const info = await probe(file);
  if (!info.durationMs || !info.width || !info.height) throw new PermanentJobError("We couldn't read one of the videos. Try “Process again” on it first.");
  return info as ProbeResult & { durationMs: number };
};

// ------------------------------------------------------------------ requests

async function ready() {
  if (!(await ffmpegAvailable())) throw new RenderError(409, NEEDS_FFMPEG);
}

function loadTestimonial(id: string) {
  const t = getTestimonial(id);
  if (!t) throw new RenderError(404, "Testimonial not found");
  return t;
}

/** VID-05: queues a multiclip of the submission's video answers (at least two). */
export async function requestMulticlip(testimonialId: string, o: { by?: string } = {}): Promise<VideoRender> {
  await ready();
  const t = loadTestimonial(testimonialId);
  if (multiclipSources(t).length < 2) throw new RenderError(400, "A multiclip needs at least two video answers in this testimonial");
  checkQueue(t.projectId, { testimonialId: t.id, kind: "multiclip" });
  return queue({ projectId: t.projectId, testimonialId: t.id, kind: "multiclip", options: {}, by: o.by });
}

/** VID-07: queues a social clip of the testimonial's video. */
export async function requestSocialClip(testimonialId: string, input: unknown, o: { by?: string } = {}): Promise<VideoRender> {
  const parsed = socialOptionsSchema.safeParse(input ?? {});
  if (!parsed.success) throw new RenderError(400, parsed.error.issues[0]?.message ?? "Invalid options");
  await ready();
  const t = loadTestimonial(testimonialId);
  if (!t.videoKey) throw new RenderError(400, "This testimonial has no video");
  if (t.mediaStatus !== "ready") throw new RenderError(409, "Wait for the video to finish converting, then make the clip");
  const opts = parsed.data;
  const length = (opts.endMs ?? t.videoDurationMs ?? 0) - (opts.startMs ?? 0);
  if (t.videoDurationMs !== null && (opts.startMs ?? 0) >= t.videoDurationMs) throw new RenderError(400, "Start inside the video");
  if (length > MAX_SOCIAL_MS) throw new RenderError(400, `A social clip can be up to ${MAX_SOCIAL_MS / 60000} minutes. Choose a start and an end.`);
  checkQueue(t.projectId, { testimonialId: t.id, kind: "social" });
  return queue({ projectId: t.projectId, testimonialId: t.id, kind: "social", options: opts, by: o.by });
}

/** VID-08: queues a render of the reel as it is now (its settings are copied, so later edits don't change it). */
export async function requestReelRender(reelId: string, o: { by?: string } = {}): Promise<VideoRender> {
  const reel = getDb().select().from(highlightReels).where(eq(highlightReels.id, reelId)).get();
  if (!reel) throw new RenderError(404, "Reel not found");
  const config = reelConfigSchema.parse(JSON.parse(reel.config || "{}"));
  if (!config.clips.length) throw new RenderError(400, "Add at least one clip first");
  if (reelLengthMs(config) > MAX_REEL_MS) throw new RenderError(400, `A reel can be up to ${MAX_REEL_MS / 60000} minutes. Shorten or remove some clips.`);
  for (const c of config.clips) reelClipTestimonial(reel.projectId, c.testimonialId);
  await ready();
  checkQueue(reel.projectId, { reelId: reel.id, kind: "reel" });
  return queue({ projectId: reel.projectId, reelId: reel.id, kind: "reel", options: config, by: o.by });
}

/** A reel may only use the project's approved, still-consented videos. */
export function reelClipTestimonial(projectId: string, id: string, fail: (status: number, message: string) => Error = (s, m) => new RenderError(s, m)) {
  const t = getTestimonial(id);
  if (!t || t.projectId !== projectId) throw fail(400, "A clip's testimonial no longer exists. Remove it and try again.");
  if (t.status !== "approved" || t.withdrawnAt) throw fail(400, `${t.authorName}’s testimonial isn't approved any more. Remove the clip and try again.`);
  if (!t.videoKey || t.mediaStatus !== "ready") throw fail(400, `${t.authorName}’s video isn't converted yet. Wait for it, then try again.`);
  return t;
}

// ------------------------------------------------------------------ the job

type Built = { file: string; durationMs: number; width: number; height: number };

/** Portrait sources make a portrait multiclip; otherwise landscape. 720p either way. */
function multiclipCanvas(infos: { width: number | null; height: number | null }[]): Canvas {
  const tall = infos.filter((i) => (i.height ?? 0) > (i.width ?? 0)).length;
  return tall * 2 > infos.length ? { w: 720, h: 1280 } : { w: 1280, h: 720 };
}

async function buildMulticlip(dir: string, r: VideoRender, project: Project): Promise<Built> {
  const t = getTestimonial(r.testimonialId!);
  if (!t) throw new PermanentJobError("The testimonial was deleted");
  const clips = multiclipSources(t);
  if (clips.length < 2) throw new PermanentJobError("A multiclip needs at least two video answers");
  return withLogo(project, (logo) =>
    withLocalFiles(
      clips.map((c) => c.key),
      async (files) => {
        const infos = await Promise.all(files.map(probed));
        const canvas = multiclipCanvas(infos);
        const total = infos.reduce((s, i) => s + i.durationMs + QUESTION_CARD_MS, 0);
        if (total > MAX_MULTICLIP_MS) throw new PermanentJobError(`The answers run longer than ${MAX_MULTICLIP_MS / 60000} minutes together`);
        const brand: Brand = { color: brandColorOf(project), logo };
        const segments: Segment[] = clips.flatMap((c, i) => [
          cardSegment(canvas, brand, c.title, `${i + 1} of ${clips.length}`, QUESTION_CARD_MS),
          { canvas, durationMs: infos[i].durationMs, background: "#000000", video: { file: files[i], startMs: 0, hasAudio: infos[i].hasAudio, fit: "contain" as const }, layers: [] },
        ]);
        return renderAll(dir, segments, canvas, { music: false });
      },
    ),
  );
}

async function buildSocial(dir: string, r: VideoRender, project: Project): Promise<Built> {
  const t = getTestimonial(r.testimonialId!);
  if (!t?.videoKey || t.mediaStatus !== "ready") throw new PermanentJobError("The video isn't converted (any more)");
  const parsed = socialOptionsSchema.safeParse(parseOptions(r));
  if (!parsed.success) throw new PermanentJobError("Invalid options");
  const opts: SocialOptions = parsed.data;
  const canvas = CANVAS[opts.format];
  return withLogo(project, (logo) =>
    withLocalFiles([t.videoKey!], async ([file]) => {
      const info = await probed(file);
      const start = Math.min(opts.startMs ?? 0, Math.max(0, info.durationMs - 1000));
      const end = Math.min(opts.endMs ?? info.durationMs, info.durationMs);
      if (end - start > MAX_SOCIAL_MS) throw new PermanentJobError(`A social clip can be up to ${MAX_SOCIAL_MS / 60000} minutes`);
      const words = opts.captions ? wordsBetween(wordsOf(t, info.durationMs), start / 1000, end / 1000) : null;
      const plan = socialLook(opts.look, canvas, { color: brandColorOf(project), logo }, opts.nameTag ? personOf(t) : null, words, { logo: opts.logo });
      const seg: Segment = {
        canvas,
        durationMs: end - start,
        background: plan.background,
        video: { file, startMs: start, hasAudio: info.hasAudio, fit: plan.fit },
        layers: plan.layers,
      };
      return renderAll(dir, [seg], canvas, { music: false });
    }),
  );
}

async function buildReel(dir: string, r: VideoRender, project: Project): Promise<Built> {
  const config: ReelConfig = reelConfigSchema.parse(parseOptions(r));
  if (!config.clips.length) throw new PermanentJobError("The reel has no clips");
  const people = config.clips.map((c) => reelClipTestimonial(project.id, c.testimonialId, (_s, m) => new PermanentJobError(m)));
  const canvas = CANVAS[config.format];
  return withLogo(project, (logo) =>
    withLocalFiles(
      people.map((t) => t.videoKey!),
      async (files) => {
        const brand: Brand = { color: brandColorOf(project), logo };
        const segments: Segment[] = [];
        if (config.title) segments.push(cardSegment(canvas, brand, config.title, config.subtitle || null, REEL_CARD_MS));
        for (let i = 0; i < config.clips.length; i++) {
          const clip = config.clips[i];
          const t = people[i];
          const info = await probed(files[i]);
          const start = Math.min(clip.startMs, Math.max(0, info.durationMs - 1000));
          const end = Math.min(clip.endMs, info.durationMs);
          if (end - start < 500) throw new PermanentJobError(`Clip ${i + 1} (${t.authorName}) starts after the video ends. Choose it again.`);
          const words = config.captions ? wordsBetween(wordsOf(t, info.durationMs), start / 1000, end / 1000) : null;
          const ratio = info.width! / info.height!;
          const close = Math.abs(ratio - canvas.w / canvas.h) < 0.15;
          segments.push({
            canvas,
            durationMs: end - start,
            background: "#000000",
            video: { file: files[i], startMs: start, hasAudio: info.hasAudio, fit: close ? "cover" : "blur" },
            layers: reelClipLayers(canvas, brand, personOf(t), words),
          });
        }
        if (config.closingTitle) segments.push(cardSegment(canvas, brand, config.closingTitle, config.closingSubtitle || null, REEL_CARD_MS));
        const total = segments.reduce((s, x) => s + x.durationMs, 0);
        if (total > MAX_REEL_MS) throw new PermanentJobError(`A reel can be up to ${MAX_REEL_MS / 60000} minutes`);
        return renderAll(dir, segments, canvas, { music: config.music });
      },
    ),
  );
}

/** Renders the segments one by one, joins them, adds the music bed if asked, and returns the finished file. */
async function renderAll(dir: string, segments: Segment[], canvas: Canvas, o: { music: boolean }): Promise<Built> {
  const total = segments.reduce((s, x) => s + x.durationMs, 0);
  const names: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const name = segName(i);
    await renderSegment(dir, segments[i], name);
    names.push(name);
  }
  let out = names[0];
  if (names.length > 1) {
    out = "joined.mp4";
    await joinSegments(dir, names, out, total);
  }
  if (o.music) {
    await addMusic(dir, out, "final.mp4", total);
    out = "final.mp4";
  }
  const file = path.join(/*turbopackIgnore: true*/ dir, out);
  const info = await probe(file);
  return { file, durationMs: info.durationMs ?? total, width: info.width ?? canvas.w, height: info.height ?? canvas.h };
}

const BUILDERS: Partial<Record<RenderKind, (dir: string, r: VideoRender, p: Project) => Promise<Built>>> = {
  multiclip: buildMulticlip,
  social: buildSocial,
  reel: buildReel,
};

function setRender(id: string, fields: Partial<typeof videoRenders.$inferInsert>) {
  getDb().update(videoRenders).set({ ...fields, updatedAt: new Date() }).where(eq(videoRenders.id, id)).run();
}

/** The job: builds the render and stores it, or records why it failed (shown in the dashboard). */
export async function runRender(renderId: string) {
  const r = getRender(renderId);
  if (!r || r.status === "ready") return;
  const build = BUILDERS[r.kind];
  const project = getProjectById(r.projectId);
  if (!build || !project) return;
  setRender(r.id, { status: "processing", error: null });
  const key = newKey("video", "mp4");
  try {
    if (!(await ffmpegAvailable())) throw new PermanentJobError(NEEDS_FFMPEG);
    const built = await withWorkDir(async (dir) => {
      const b = await build(dir, r, project);
      const size = (await fs.promises.stat(b.file)).size;
      if (size > MAX_OUTPUT_BYTES) throw new PermanentJobError("The video came out larger than 1 GB");
      await storage().put(key, { path: b.file, move: true }, "video/mp4");
      return { ...b, size };
    });
    // Deleted while it rendered: nothing is left pointing at the file.
    if (!getRender(r.id)) {
      await removeFiles([key]);
      return;
    }
    setRender(r.id, { status: "ready", key, files: JSON.stringify([key]), durationMs: built.durationMs, width: built.width, height: built.height, sizeBytes: built.size });
    await prune(getRender(r.id)!);
  } catch (err) {
    if (getRender(r.id)) setRender(r.id, { status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    throw err instanceof PermanentJobError ? err : new PermanentJobError(err instanceof Error ? err.message : String(err));
  }
}

/** Keeps a few recent renders: the newest multiclip (and the one in use), six social clips, three per reel. */
async function prune(r: VideoRender) {
  const db = getDb();
  const same =
    r.kind === "reel"
      ? db.select().from(videoRenders).where(and(eq(videoRenders.reelId, r.reelId!), eq(videoRenders.kind, "reel"))).orderBy(desc(videoRenders.createdAt)).all()
      : db
          .select()
          .from(videoRenders)
          .where(and(eq(videoRenders.testimonialId, r.testimonialId!), eq(videoRenders.kind, r.kind)))
          .orderBy(desc(videoRenders.createdAt))
          .all();
  const keep = r.kind === "multiclip" ? 1 : r.kind === "reel" ? KEEP_REEL : KEEP_SOCIAL;
  const old = same.filter((x) => x.status === "ready" || x.status === "failed").slice(keep).filter((x) => !x.usedAsVideo && x.id !== r.id);
  for (const x of old) await deleteRenderRow(x);
}

async function deleteRenderRow(r: VideoRender) {
  getDb().delete(videoRenders).where(eq(videoRenders.id, r.id)).run();
  const keys = [...new Set([r.key, ...renderFiles(r.files)].filter((k): k is string => Boolean(k)))];
  await removeFiles(keys.filter((k) => !stillUsed(k)));
}

/** Deletes a render and its file. A multiclip that is the testimonial's video stays until the owner switches back. */
export async function deleteRender(id: string): Promise<boolean> {
  const r = getRender(id);
  if (!r) return false;
  if (r.kind === "hls") throw new RenderError(400, "The streaming copy is managed for you");
  if (r.usedAsVideo) throw new RenderError(409, "This multiclip is the testimonial's video. Switch back to the first answer before deleting it.");
  if (r.status === "queued" || r.status === "processing") throw new RenderError(409, "It's still being made. Delete it once it has finished.");
  await deleteRenderRow(r);
  return true;
}

/** A file name for a download: the author's or reel's name, letters and digits only. */
export function renderFileName(r: VideoRender, label: string) {
  const base =
    label
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 40) || "plaudit";
  return `${base}-${r.kind === "social" ? `${String(parseOptions(r).format ?? "social")}-clip` : r.kind}.mp4`;
}

// ------------------------------------------------------------------ VID-05: use a multiclip as the video

const videoReset = {
  posterKey: null,
  posterAtMs: null,
  posterCustom: false,
  trimStartMs: null,
  trimEndMs: null,
  transcript: null,
  captionsVtt: null,
} as const;

/** Clears the facts about the old file that aren't edits of their own (as replacing a video does, VID-03). */
function resetFacts(testimonialId: string) {
  getDb()
    .update(schema.testimonials)
    .set({ videoMime: "video/mp4", videoDurationMs: null, videoWidth: null, videoHeight: null, mediaError: null, transcriptStatus: "none", transcriptError: null })
    .where(eq(schema.testimonials.id, testimonialId))
    .run();
}

/**
 * VID-05: makes a ready multiclip the testimonial's video (`renderId`), or
 * puts the main answer's own video back (null). The video is converted
 * again and its transcript made again; trim and poster start over. The main
 * answer's file is kept on the multiclip's row, so switching back loses nothing.
 */
export async function useMulticlip(testimonialId: string, renderId: string | null, o: { by?: string } = {}) {
  const t = loadTestimonial(testimonialId);
  const current = multiclipInUse(t);
  const db = getDb();
  const before = [t.videoKey, t.posterKey];
  if (renderId === null) {
    if (!current) return getTestimonial(testimonialId)!;
    if (!current.replacedKey) throw new RenderError(409, "The first answer's video is missing");
    db.update(videoRenders).set({ usedAsVideo: false, replacedKey: null, updatedAt: new Date() }).where(eq(videoRenders.id, current.id)).run();
    resetFacts(t.id);
    updateTestimonial(t.id, { videoKey: current.replacedKey, videoOriginalKey: current.replacedKey, ...videoReset }, { by: o.by });
  } else {
    const r = getRender(renderId);
    if (!r || r.testimonialId !== t.id || r.kind !== "multiclip") throw new RenderError(404, "Multiclip not found");
    if (r.status !== "ready" || !r.key) throw new RenderError(409, "Wait for the multiclip to finish first");
    if (current?.id === r.id) return t;
    const replaced = current?.replacedKey ?? t.videoOriginalKey ?? t.videoKey;
    db.transaction((tx) => {
      tx.update(videoRenders).set({ usedAsVideo: false, replacedKey: null }).where(eq(videoRenders.testimonialId, t.id)).run();
      tx.update(videoRenders).set({ usedAsVideo: true, replacedKey: replaced, updatedAt: new Date() }).where(eq(videoRenders.id, r.id)).run();
    });
    resetFacts(t.id);
    updateTestimonial(t.id, { videoKey: r.key, videoOriginalKey: r.key, ...videoReset }, { by: o.by });
  }
  await queueVideoProcessing(t.id);
  // The old converted MP4 and poster, unless something else (the multiclip row, the original) still uses them.
  const unused = [...new Set(before.filter((k): k is string => Boolean(k)))].filter((k) => !stillUsed(k));
  if (unused.length) await removeFiles(unused);
  return getTestimonial(testimonialId)!;
}

/**
 * VID-03 replaced the video while a multiclip was in use: the multiclip is
 * just a multiclip again, and the main answer's old file goes like any
 * replaced original (unless something else uses it).
 */
export async function releaseMulticlip(testimonialId: string) {
  const db = getDb();
  const used = db
    .select()
    .from(videoRenders)
    .where(and(eq(videoRenders.testimonialId, testimonialId), eq(videoRenders.usedAsVideo, true)))
    .all();
  if (!used.length) return;
  db.update(videoRenders).set({ usedAsVideo: false, replacedKey: null, updatedAt: new Date() }).where(eq(videoRenders.testimonialId, testimonialId)).run();
  const old = used.map((r) => r.replacedKey).filter((k): k is string => Boolean(k) && !stillUsed(k!));
  if (old.length) await removeFiles(old);
}
