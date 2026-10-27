import crypto from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { TestimonialImage } from "@/db/schema";

const { testimonialImages } = schema;

/** Images attached to a form answer (at most 3 per question), or added by hand. */
export const MAX_IMAGES_PER_QUESTION = 3;

export type NewImage = { questionKey: string | null; key: string; alt?: string | null };

/** Adds images inside a transaction, in the order given. */
export function insertImages(tx: Tx, testimonialId: string, rows: NewImage[]): TestimonialImage[] {
  if (!rows.length) return [];
  const now = new Date();
  return tx
    .insert(testimonialImages)
    .values(
      rows.map((r, position) => ({
        id: crypto.randomUUID(),
        testimonialId,
        questionKey: r.questionKey,
        key: r.key,
        alt: r.alt ?? null,
        position,
        createdAt: now,
      })),
    )
    .returning()
    .all();
}

export function listImages(testimonialId: string): TestimonialImage[] {
  return getDb()
    .select()
    .from(testimonialImages)
    .where(eq(testimonialImages.testimonialId, testimonialId))
    .orderBy(asc(testimonialImages.position))
    .all();
}
