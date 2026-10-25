import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Approver } from "@/db/schema";
import { env } from "./env";
import { deleteTestimonial, getTestimonial, updateTestimonial, type TestimonialWithTags } from "./testimonials";

const { testimonials } = schema;

/**
 * The trash: a testimonial moved there is off every public page but can be
 * restored, status and all, until it's purged TRASH_RETENTION_DAYS (30 by
 * default) later. Deleting for good is still DELETE /api/admin/testimonials/[id],
 * which the dashboard offers only from the trash (D6).
 */

/** Thrown when restoring something that isn't in the trash. */
export class NotInTrashError extends Error {
  constructor() {
    super("This testimonial isn't in the trash");
  }
}

type By = { by?: string; actor?: Approver };

/** Moves a testimonial to the trash (sends testimonial.trashed). Already there: returned as it is. */
export function trashTestimonial(id: string, o: By = {}): TestimonialWithTags | null {
  const t = getTestimonial(id);
  if (!t || t.status === "trashed") return t;
  return updateTestimonial(id, { status: "trashed" }, { by: o.by, actor: o.actor });
}

/**
 * Puts a trashed testimonial back where it was (sends testimonial.restored).
 * One whose author withdrew consent always comes back as rejected.
 */
export function restoreTestimonial(id: string, o: By = {}): TestimonialWithTags | null {
  const t = getTestimonial(id);
  if (!t) return null;
  if (t.status !== "trashed") throw new NotInTrashError();
  const back = t.withdrawnAt ? "rejected" : (t.statusBeforeTrash ?? "pending");
  // A row trashed before it had a status to go back to, or trashed twice, lands in Pending.
  return updateTestimonial(id, { status: back === "trashed" ? "pending" : back }, { by: o.by, actor: o.actor });
}

/** Deletes for good what has been in the trash longer than the retention period. Returns how many. */
export async function purgeTrash(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - env.trashRetentionDays * 24 * 60 * 60 * 1000);
  const due = getDb()
    .select({ id: testimonials.id })
    .from(testimonials)
    .where(and(eq(testimonials.status, "trashed"), lt(testimonials.trashedAt, cutoff)))
    .all();
  let purged = 0;
  // One at a time: each delete sends its webhook and removes its files.
  for (const { id } of due) if (await deleteTestimonial(id)) purged++;
  return purged;
}
