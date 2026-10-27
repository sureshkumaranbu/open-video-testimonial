import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Feedback } from "@/db/schema";

const { feedback } = schema;

/**
 * Private feedback: answers to a form's private question. Stored apart from
 * the testimonial and never published (no public route reads this table).
 */

export type NewFeedback = {
  formId: string | null;
  customerId: string | null;
  testimonialId: string | null;
  rating: number | null;
  text: string;
  authorName: string | null;
  authorEmail: string | null;
};

/** Adds a submission's private answers inside its transaction. */
export function insertFeedback(tx: Tx, projectId: string, rows: NewFeedback[]): Feedback[] {
  if (!rows.length) return [];
  const now = new Date();
  return tx
    .insert(feedback)
    .values(rows.map((r) => ({ ...r, id: crypto.randomUUID(), projectId, source: "private-question" as const, createdAt: now })))
    .returning()
    .all();
}

/** The project's feedback, newest first (trashed rows left out). */
export function listFeedback(projectId: string, limit = 100): Feedback[] {
  return getDb()
    .select()
    .from(feedback)
    .where(and(eq(feedback.projectId, projectId), isNull(feedback.trashedAt)))
    .orderBy(desc(feedback.createdAt))
    .limit(limit)
    .all();
}
