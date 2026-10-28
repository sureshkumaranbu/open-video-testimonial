import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { HighlightReel } from "@/db/schema";
import { trimVtt } from "../captions";
import { trimOf } from "../media";
import { mediaUrl, removeFiles } from "../storage";
import { renderFiles, stillUsed } from "../testimonials";
import { reelConfigSchema, reelInputSchema, reelLengthMs, type ReelConfig } from "./reel-config";
import { renderToAdmin, RenderError } from "./renders";
import { wordsFromVtt, type Word } from "./words";

const { highlightReels, videoRenders, testimonials } = schema;

/**
 * VID-08: highlight reels, kept per project. A reel is a list of clips (a
 * testimonial and the part of its video to use, chosen by selecting words
 * of its transcript or by times), optional title and closing cards, and
 * music on or off. Rendering copies the reel's settings into a render job
 * (src/lib/video/renders.ts), so a reel can be changed and rendered again.
 */

export function parseReelConfig(raw: string | null | undefined): ReelConfig {
  try {
    const parsed = reelConfigSchema.safeParse(JSON.parse(raw || "{}"));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  return reelConfigSchema.parse({});
}

export function listReels(projectId: string): HighlightReel[] {
  return getDb().select().from(highlightReels).where(eq(highlightReels.projectId, projectId)).orderBy(desc(highlightReels.updatedAt)).all();
}

export function getReel(id: string): HighlightReel | null {
  return getDb().select().from(highlightReels).where(eq(highlightReels.id, id)).get() ?? null;
}

/** Clips whose testimonial can't go in a reel right now (deleted, not approved, withdrawn, not converted), as sentences. */
export function reelWarnings(projectId: string, config: ReelConfig): string[] {
  const ids = [...new Set(config.clips.map((c) => c.testimonialId))];
  if (!ids.length) return [];
  const rows = getDb()
    .select({ id: testimonials.id, projectId: testimonials.projectId, name: testimonials.authorName, status: testimonials.status, withdrawnAt: testimonials.withdrawnAt, mediaStatus: testimonials.mediaStatus })
    .from(testimonials)
    .where(inArray(testimonials.id, ids))
    .all();
  return config.clips.flatMap((c, i) => {
    const t = rows.find((r) => r.id === c.testimonialId && r.projectId === projectId);
    if (!t) return [`Clip ${i + 1}: its testimonial was deleted.`];
    if (t.status !== "approved" || t.withdrawnAt) return [`Clip ${i + 1}: ${t.name}’s testimonial isn't approved any more.`];
    if (t.mediaStatus !== "ready") return [`Clip ${i + 1}: ${t.name}’s video isn't converted.`];
    return [];
  });
}

export function reelToAdmin(reel: HighlightReel) {
  const config = parseReelConfig(reel.config);
  const renders = getDb().select().from(videoRenders).where(eq(videoRenders.reelId, reel.id)).orderBy(desc(videoRenders.createdAt)).all();
  return {
    id: reel.id,
    projectId: reel.projectId,
    name: reel.name,
    config,
    lengthMs: reelLengthMs(config),
    warnings: reelWarnings(reel.projectId, config),
    renders: renders.map(renderToAdmin),
    createdAt: reel.createdAt.toISOString(),
    updatedAt: reel.updatedAt.toISOString(),
  };
}
export type AdminReel = ReturnType<typeof reelToAdmin>;

function parseInput(input: unknown) {
  const parsed = reelInputSchema.safeParse(input);
  if (!parsed.success) throw new RenderError(400, parsed.error.issues[0]?.message ?? "Invalid reel");
  return parsed.data;
}

/** Clips may only name this project's testimonials. */
function checkClips(projectId: string, config: ReelConfig) {
  const ids = [...new Set(config.clips.map((c) => c.testimonialId))];
  if (!ids.length) return;
  const found = getDb()
    .select({ id: testimonials.id })
    .from(testimonials)
    .where(and(inArray(testimonials.id, ids), eq(testimonials.projectId, projectId)))
    .all();
  if (found.length !== ids.length) throw new RenderError(400, "A clip names a testimonial that isn't in this project");
}

export function createReel(projectId: string, input: unknown): HighlightReel {
  const { name, config } = parseInput(input);
  checkClips(projectId, config);
  const now = new Date();
  return getDb()
    .insert(highlightReels)
    .values({ id: crypto.randomUUID(), projectId, name, config: JSON.stringify(config), createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateReel(id: string, input: unknown): HighlightReel | null {
  const reel = getReel(id);
  if (!reel) return null;
  const { name, config } = parseInput(input);
  checkClips(reel.projectId, config);
  return getDb().update(highlightReels).set({ name, config: JSON.stringify(config), updatedAt: new Date() }).where(eq(highlightReels.id, id)).returning().get() ?? null;
}

/** Deletes the reel and every render of it. */
export async function deleteReel(id: string): Promise<boolean> {
  const db = getDb();
  const renders = db.select().from(videoRenders).where(eq(videoRenders.reelId, id)).all();
  if (renders.some((r) => r.status === "processing")) throw new RenderError(409, "A render of this reel is being made. Delete the reel once it has finished.");
  if (!db.delete(highlightReels).where(eq(highlightReels.id, id)).returning({ id: highlightReels.id }).get()) return false;
  const keys = [...new Set(renders.flatMap((r) => [r.key, ...renderFiles(r.files)]).filter((k): k is string => Boolean(k)))];
  await removeFiles(keys.filter((k) => !stillUsed(k)));
  return true;
}

/** How many testimonials the clip picker lists. */
const PICKER_LIMIT = 200;

/**
 * The project's approved, converted video testimonials for the clip picker,
 * each with its words and times when it has captions (so the owner can
 * choose a clip by selecting text); without captions the picker uses times.
 */
export function reelCandidates(projectId: string) {
  return getDb()
    .select()
    .from(testimonials)
    .where(and(eq(testimonials.projectId, projectId), eq(testimonials.status, "approved"), isNull(testimonials.withdrawnAt), eq(testimonials.mediaStatus, "ready")))
    .orderBy(desc(testimonials.createdAt))
    .limit(PICKER_LIMIT)
    .all()
    .filter((t) => t.videoKey)
    .map((t) => {
      const words: Word[] | null = t.captionsVtt ? wordsFromVtt(trimVtt(t.captionsVtt, trimOf(t))) : null;
      return {
        id: t.id,
        name: t.authorName,
        detail: [t.authorTitle, t.authorCompany].filter(Boolean).join(", ") || null,
        durationMs: t.videoDurationMs,
        videoUrl: mediaUrl(t.videoKey),
        posterUrl: mediaUrl(t.posterKey),
        transcript: t.transcript,
        words: words?.length ? words : null,
      };
    });
}
export type ReelCandidate = ReturnType<typeof reelCandidates>[number];
