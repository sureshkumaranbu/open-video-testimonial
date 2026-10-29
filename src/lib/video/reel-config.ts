import { z } from "zod";
import { MAX_SOCIAL_MS, RENDER_FORMATS, SOCIAL_LOOKS } from "./looks";

/**
 * What the owner chooses for a render, validated the same way in the
 * browser and on the server. Client-safe.
 */

if (typeof window !== "undefined") z.config({ jitless: true });

const ms = z.number().int("Times are whole milliseconds").min(0).max(86_400_000);

/** VID-07. Start and end are in the served video's time (after any trim); null = from the start / to the end. */
export const socialOptionsSchema = z
  .object({
    look: z.enum(SOCIAL_LOOKS).default("studio"),
    format: z.enum(["vertical", "square"]).default("vertical"),
    captions: z.boolean().default(true),
    nameTag: z.boolean().default(true),
    logo: z.boolean().default(true),
    startMs: ms.nullable().default(null),
    endMs: ms.nullable().default(null),
  })
  .refine((o) => o.startMs === null || o.endMs === null || o.endMs - o.startMs >= 1000, { message: "Keep at least one second" })
  .refine((o) => o.startMs === null || o.endMs === null || o.endMs - o.startMs <= MAX_SOCIAL_MS, { message: `A social clip can be up to ${MAX_SOCIAL_MS / 60000} minutes` });
export type SocialOptions = z.infer<typeof socialOptionsSchema>;

/** VID-08: the most clips in a reel, and the longest clip. */
export const MAX_REEL_CLIPS = 20;
export const MAX_REEL_CLIP_MS = 120_000;
/** VID-08: the longest reel, cards included. */
export const MAX_REEL_MS = 10 * 60_000;
/** How long a title or closing card stays up. */
export const REEL_CARD_MS = 3000;

export const reelClipSchema = z
  .object({
    testimonialId: z.string().trim().min(1).max(64),
    startMs: ms,
    endMs: ms,
  })
  .refine((c) => c.endMs - c.startMs >= 1000, { message: "Each clip needs at least one second" })
  .refine((c) => c.endMs - c.startMs <= MAX_REEL_CLIP_MS, { message: `A clip can be up to ${MAX_REEL_CLIP_MS / 1000} seconds` });
export type ReelClip = z.infer<typeof reelClipSchema>;

const line = (max: number) => z.string().trim().max(max).default("");

export const reelConfigSchema = z.object({
  format: z.enum(RENDER_FORMATS).default("landscape"),
  title: line(120),
  subtitle: line(160),
  closingTitle: line(120),
  closingSubtitle: line(160),
  /** Our own synthesised ambient bed under the reel (no third-party audio). */
  music: z.boolean().default(true),
  captions: z.boolean().default(true),
  clips: z.array(reelClipSchema).max(MAX_REEL_CLIPS, `A reel can have up to ${MAX_REEL_CLIPS} clips`).default([]),
});
export type ReelConfig = z.infer<typeof reelConfigSchema>;

export const reelInputSchema = z.object({
  name: z.string().trim().min(1, "Give the reel a name").max(120),
  config: reelConfigSchema.prefault({}),
});

/** How long the reel will run, cards included. */
export function reelLengthMs(c: ReelConfig) {
  const cards = (c.title ? REEL_CARD_MS : 0) + (c.closingTitle ? REEL_CARD_MS : 0);
  return cards + c.clips.reduce((sum, clip) => sum + Math.max(0, clip.endMs - clip.startMs), 0);
}
