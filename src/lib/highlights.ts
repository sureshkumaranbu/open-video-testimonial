import crypto from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import type { Approver, Highlight } from "@/db/schema";
import { historyActor, recordHistory } from "./history";

const { highlights, testimonials, answers } = schema;

/**
 * Highlighted phrases (INBOX-08): spans of the main text or of an answer that
 * widgets and walls can emphasise. Each keeps its phrase, so an edit to the
 * text moves it to where the phrase now is, or drops it once it's gone.
 */

export const MAX_HIGHLIGHTS = 50;

/** A highlight the request asked for that can't be kept as it is. */
export class HighlightError extends Error {}

export type HighlightInput = { answerId: string | null; start: number; end: number };

const byPosition = (a: Highlight, b: Highlight) =>
  (a.answerId ?? "").localeCompare(b.answerId ?? "") || a.start - b.start;

export function listHighlights(testimonialId: string): Highlight[] {
  return getDb()
    .select()
    .from(highlights)
    .where(eq(highlights.testimonialId, testimonialId))
    .orderBy(asc(highlights.start))
    .all()
    .sort(byPosition);
}

/** Replaces every highlight of a testimonial. Returns null when it doesn't exist. */
export function setHighlights(
  testimonialId: string,
  list: HighlightInput[],
  o: { by?: string; actor?: Approver } = {},
): Highlight[] | null {
  const db = getDb();
  const t = db.select({ id: testimonials.id, text: testimonials.text }).from(testimonials).where(eq(testimonials.id, testimonialId)).get();
  if (!t) return null;
  if (list.length > MAX_HIGHLIGHTS) throw new HighlightError(`A testimonial can have at most ${MAX_HIGHLIGHTS} highlights`);
  const texts = new Map<string | null, string>([[null, t.text ?? ""]]);
  for (const a of db.select({ id: answers.id, text: answers.text }).from(answers).where(eq(answers.testimonialId, testimonialId)).all()) {
    texts.set(a.id, a.text ?? "");
  }
  const now = new Date();
  const wanted = list
    .map((h) => {
      const text = texts.get(h.answerId);
      if (text === undefined) throw new HighlightError("That answer belongs to another testimonial");
      if (!Number.isInteger(h.start) || !Number.isInteger(h.end) || h.start < 0 || h.end > text.length || h.start >= h.end) {
        throw new HighlightError("A highlight must cover part of the text");
      }
      const phrase = text.slice(h.start, h.end);
      if (!phrase.trim()) throw new HighlightError("A highlight must include more than spaces");
      return { id: crypto.randomUUID(), testimonialId, answerId: h.answerId, start: h.start, end: h.end, phrase, createdAt: now };
    })
    .sort(byPosition);
  for (let i = 1; i < wanted.length; i++) {
    if (wanted[i].answerId === wanted[i - 1].answerId && wanted[i].start < wanted[i - 1].end) {
      throw new HighlightError("Highlights can't overlap");
    }
  }
  const before = listHighlights(testimonialId).map((h) => h.phrase);
  const after = wanted.map((h) => h.phrase);
  db.transaction((tx) => {
    tx.delete(highlights).where(eq(highlights.testimonialId, testimonialId)).run();
    if (wanted.length) tx.insert(highlights).values(wanted).run();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      recordHistory(tx, {
        testimonialId,
        actor: historyActor(o.actor),
        actorEmail: o.by,
        action: "highlights",
        diff: { highlights: [before, after] },
        at: now,
      });
    }
  });
  return listHighlights(testimonialId);
}

/** Where `phrase` now occurs in `text` closest to `near` and where `ok` allows, or -1. */
function nearest(text: string, phrase: string, near: number, ok: (at: number) => boolean) {
  let best = -1;
  for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
    if (ok(i) && (best === -1 || Math.abs(i - near) < Math.abs(best - near))) best = i;
  }
  return best;
}

/**
 * After the main text (answerId null) or an answer changes: highlights whose
 * phrase is still at the same place stay, the others move to the nearest place
 * the phrase now appears that no other highlight covers, and the rest are
 * dropped, so highlights never overlap (as setHighlights requires). Runs
 * inside the edit's transaction.
 */
export function reanchorHighlights(tx: Tx, testimonialId: string, answerId: string | null, newText: string | null): void {
  const text = newText ?? "";
  const rows = tx
    .select()
    .from(highlights)
    .where(
      and(
        eq(highlights.testimonialId, testimonialId),
        answerId === null ? isNull(highlights.answerId) : eq(highlights.answerId, answerId),
      ),
    )
    .all();
  const stays = (h: Highlight) => text.slice(h.start, h.end) === h.phrase;
  const taken = rows.filter(stays).map((h) => [h.start, h.end] as const);
  for (const h of rows.filter((r) => !stays(r)).sort((a, b) => a.start - b.start)) {
    const len = h.phrase.length;
    const at = nearest(text, h.phrase, h.start, (i) => taken.every(([s, e]) => i + len <= s || i >= e));
    if (at === -1) tx.delete(highlights).where(eq(highlights.id, h.id)).run();
    else {
      taken.push([at, at + len]);
      tx.update(highlights).set({ start: at, end: at + len }).where(eq(highlights.id, h.id)).run();
    }
  }
}
