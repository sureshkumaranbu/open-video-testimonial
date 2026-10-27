import crypto from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Answer, Approver } from "@/db/schema";
import { logConsentEvent } from "./consent";
import { reanchorHighlights } from "./highlights";
import { historyActor, recordHistory } from "./history";
import { getTestimonial, refreshWordCount } from "./testimonials";
import { emitTestimonialEvent } from "./webhooks";

const { answers, testimonials } = schema;

/**
 * Answers to a form's questions 2..N. The first answered question stays on
 * the testimonial itself (text and video), so public output is unchanged;
 * these are shown to the owner, and their videos stay private (D13).
 */

export type NewAnswer = Omit<typeof answers.$inferInsert, "id" | "testimonialId" | "createdAt" | "updatedAt">;

export function listAnswers(testimonialId: string): Answer[] {
  return getDb().select().from(answers).where(eq(answers.testimonialId, testimonialId)).orderBy(asc(answers.position)).all();
}

/** Answers of many testimonials at once, by testimonial id (each list in question order). */
export function answersFor(ids: string[]): Map<string, Answer[]> {
  const byId = new Map<string, Answer[]>();
  if (!ids.length) return byId;
  const rows = getDb().select().from(answers).where(inArray(answers.testimonialId, ids)).orderBy(asc(answers.position)).all();
  for (const a of rows) byId.set(a.testimonialId, [...(byId.get(a.testimonialId) ?? []), a]);
  return byId;
}

/** Adds a new submission's answers inside its transaction, and counts their words into the testimonial's. */
export function insertAnswers(tx: Tx, testimonialId: string, rows: NewAnswer[]): Answer[] {
  if (!rows.length) return [];
  const now = new Date();
  const inserted = tx
    .insert(answers)
    .values(rows.map((r) => ({ ...r, id: crypto.randomUUID(), testimonialId, createdAt: now, updatedAt: now })))
    .returning()
    .all();
  refreshWordCount(tx, testimonialId);
  return inserted.sort((a, b) => a.position - b.position);
}

/**
 * The owner corrects an answer's text. Like an edit to the main text, it's
 * allowed but recorded: the testimonial is marked edited after consent, the
 * consent ledger and the history say what changed, highlights move with their
 * phrase, and testimonial.updated is sent (opt-in).
 */
export function updateAnswer(id: string, patch: { text: string | null }, o: { by?: string; actor?: Approver } = {}): Answer | null {
  const db = getDb();
  const answer = db.select().from(answers).where(eq(answers.id, id)).get();
  if (!answer) return null;
  const text = patch.text?.trim() ? patch.text : null;
  if (text === answer.text) return answer;
  const now = new Date();
  db.transaction((tx) => {
    tx.update(answers).set({ text, updatedAt: now }).where(eq(answers.id, id)).run();
    reanchorHighlights(tx, answer.testimonialId, id, text);
    tx.update(testimonials).set({ editedAfterConsent: true, updatedAt: now }).where(eq(testimonials.id, answer.testimonialId)).run();
    refreshWordCount(tx, answer.testimonialId);
    recordHistory(tx, {
      testimonialId: answer.testimonialId,
      actor: historyActor(o.actor),
      actorEmail: o.by,
      action: "answer_edited",
      diff: { [`answer:${answer.questionKey}`]: [answer.text, text] },
      at: now,
    });
  });
  logConsentEvent({
    testimonialId: answer.testimonialId,
    type: "edited",
    actor: o.actor === "api" ? "api" : "owner",
    detail: `Changed after consent: the answer to "${answer.questionTitle}"`,
  });
  emitTestimonialEvent("testimonial.updated", getTestimonial(answer.testimonialId));
  return db.select().from(answers).where(eq(answers.id, id)).get() ?? null;
}
