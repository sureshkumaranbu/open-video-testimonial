import { isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { registerPeriodic } from "./jobs";
import { refreshWordCount } from "./testimonials";
import { purgeTrash } from "./trash";

const { testimonials } = schema;

/**
 * Periodic housekeeping: `trash.purge` (every 6 h) deletes testimonials that
 * have been in the trash longer than TRASH_RETENTION_DAYS, and
 * `maintenance.word-count` (hourly) counts words where word_count is still
 * null: rows from before migration 0009, and rows written around
 * updateTestimonial (imports, archive restores).
 */
export const TRASH_PURGE_TASK = "trash.purge";
export const WORD_COUNT_TASK = "maintenance.word-count";
const WORD_COUNT_BATCH = 500;

/** Fills word_count for up to `limit` rows that don't have one yet. Returns how many. */
export function backfillWordCounts(limit = WORD_COUNT_BATCH) {
  const db = getDb();
  const ids = db.select({ id: testimonials.id }).from(testimonials).where(isNull(testimonials.wordCount)).limit(limit).all();
  if (ids.length) db.transaction((tx) => ids.forEach(({ id }) => refreshWordCount(tx, id)));
  return ids.length;
}

export function registerMaintenanceJobs(): void {
  registerPeriodic(TRASH_PURGE_TASK, 6 * 60 * 60 * 1000, () => purgeTrash());
  registerPeriodic(WORD_COUNT_TASK, 60 * 60 * 1000, () => backfillWordCounts());
}
