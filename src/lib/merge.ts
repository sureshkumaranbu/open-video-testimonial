import crypto from "node:crypto";
import { and, asc, eq, inArray, max, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Testimonial } from "@/db/schema";
import { listConsentEvents } from "./consent";
import { recordHistory } from "./history";
import { getTestimonial, refreshWordCount } from "./testimonials";
import { emitTestimonialEvent } from "./webhooks";

const { testimonials, answers, highlights, testimonialImages, testimonialTags, tags, consentEvents } = schema;

/**
 * Duplicates and merging (INBOX-11). Imports can't duplicate (the dedupe
 * key), but the same person sends twice, or is added by hand after they
 * sent one. Likely pairs: the same customer or email, or the same name with
 * very similar words.
 *
 * Merging B into A copies, never moves: B's main text or video and its other
 * answers become extra answers on A (owner-only, D13), its tags and images
 * join A's, its highlights are copied onto the copies, and its consent ledger
 * is copied onto A's (B keeps its own). B goes to the trash marked as merged.
 * Nothing on A's public side changes: answers are never public, and images
 * from a B that wasn't public itself stay owner-only. Restoring B is safe: it
 * comes back as it was, in Pending, and A keeps the copies.
 */

// ------------------------------------------------------------------ finding

/** Lower case, no accents or punctuation, single spaces. */
export function normaliseName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trigrams(s: string) {
  const t = ` ${normaliseName(s)} `;
  const out = new Map<string, number>();
  for (let i = 0; i + 3 <= t.length; i++) {
    const g = t.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** 0..1: how much two texts share (Dice coefficient over letter trigrams; one inside the other counts as 1). */
export function textSimilarity(a: string, b: string) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb || (Math.min(na.length, nb.length) >= 20 && (na.includes(nb) || nb.includes(na)))) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  let total = 0;
  for (const [g, n] of ta) {
    shared += Math.min(n, tb.get(g) ?? 0);
    total += n;
  }
  for (const n of tb.values()) total += n;
  return total ? (2 * shared) / total : 0;
}

/** Texts at least this similar, from people with the same name, count as likely duplicates. */
export const SIMILAR_TEXT = 0.75;
/** The most rows the finder reads (the inbox is built for 10k). */
const MAX_ROWS = 20_000;
/** People with one very common name (or "Anonymous") aren't compared beyond this many testimonials. */
const MAX_SAME_NAME = 200;

type Row = Pick<Testimonial, "id" | "customerId" | "authorEmail" | "authorName" | "text" | "headline" | "createdAt">;

/**
 * Groups of testimonials (not in the trash) that are probably the same
 * person saying the same thing twice, oldest first in each group.
 */
export function duplicateGroups(projectId: string): string[][] {
  const rows: Row[] = getDb()
    .select({ id: testimonials.id, customerId: testimonials.customerId, authorEmail: testimonials.authorEmail, authorName: testimonials.authorName, text: testimonials.text, headline: testimonials.headline, createdAt: testimonials.createdAt })
    .from(testimonials)
    .where(and(eq(testimonials.projectId, projectId), ne(testimonials.status, "trashed")))
    .orderBy(asc(testimonials.createdAt), asc(testimonials.id))
    .limit(MAX_ROWS)
    .all();
  const parent = new Map<string, string>(rows.map((r) => [r.id, r.id]));
  const find = (x: string): string => {
    let p = parent.get(x)!;
    while (p !== parent.get(p)) p = parent.get(p)!;
    parent.set(x, p);
    return p;
  };
  const join = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const by = (key: (r: Row) => string | null) => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      const first = seen.get(k);
      if (first) join(first, r.id);
      else seen.set(k, r.id);
    }
  };
  by((r) => r.customerId);
  by((r) => r.authorEmail?.trim().toLowerCase() || null);
  const byName = new Map<string, Row[]>();
  for (const r of rows) {
    const n = normaliseName(r.authorName);
    if (!n) continue;
    byName.set(n, [...(byName.get(n) ?? []), r]);
  }
  for (const list of byName.values()) {
    const capped = list.slice(0, MAX_SAME_NAME);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        const a = capped[i].text ?? capped[i].headline ?? "";
        const b = capped[j].text ?? capped[j].headline ?? "";
        if (a && b && textSimilarity(a, b) >= SIMILAR_TEXT) join(capped[i].id, capped[j].id);
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const root = find(r.id);
    groups.set(root, [...(groups.get(root) ?? []), r.id]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Every testimonial that has a likely duplicate, mapped to the others in its group. */
export function duplicateMap(projectId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const g of duplicateGroups(projectId)) for (const id of g) out.set(id, g.filter((x) => x !== id));
  return out;
}

/** The likely duplicates of one testimonial, as the "Merge into…" dialog lists them. */
export function duplicatesOf(projectId: string, id: string) {
  const others = duplicateMap(projectId).get(id) ?? [];
  if (!others.length) return [];
  return getDb()
    .select({ id: testimonials.id, authorName: testimonials.authorName, authorEmail: testimonials.authorEmail, text: testimonials.text, status: testimonials.status, createdAt: testimonials.createdAt })
    .from(testimonials)
    .where(inArray(testimonials.id, others))
    .all()
    .map((t) => ({ ...t, text: t.text ? t.text.slice(0, 200) : null, createdAt: t.createdAt.toISOString() }));
}

// ------------------------------------------------------------------ merging

export class MergeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const busy = (s: string) => s === "queued" || s === "processing";
const MAX_TAGS = 20;
/** answers.question_key and the export's limit. */
const KEY_MAX = 40;

/** Whether B was itself public, with at least A's consent: only then may its images show on A. */
function wasPublicUnder(b: Testimonial, a: Testimonial) {
  if (b.status !== "approved" || b.withdrawnAt || !b.consentPublic) return false;
  const scopes = (raw: string) => {
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  const bs = new Set(scopes(b.consentScopes));
  return scopes(a.consentScopes).every((s) => bs.has(s));
}

/**
 * Merges `fromId` into `intoId` (both in `projectId`): see the module note.
 * Refused across projects, from or into the trash, when either author
 * withdrew consent, and while B's video is still converting. Returns both rows.
 */
export function mergeTestimonials(projectId: string, fromId: string, intoId: string, o: { by?: string } = {}) {
  if (fromId === intoId) throw new MergeError(400, "Choose another testimonial to merge into");
  const db = getDb();
  const b = db.select().from(testimonials).where(eq(testimonials.id, fromId)).get();
  const a = db.select().from(testimonials).where(eq(testimonials.id, intoId)).get();
  if (!a || !b || a.projectId !== projectId || b.projectId !== projectId) throw new MergeError(404, "Both testimonials must be in this project");
  if (a.status === "trashed" || b.status === "trashed") throw new MergeError(409, "Restore it from the trash before merging");
  if (a.withdrawnAt || b.withdrawnAt) throw new MergeError(409, "The author withdrew consent for one of these, so they can't be merged");
  if (busy(b.mediaStatus) || busy(b.transcriptStatus)) throw new MergeError(409, "Its video is still being processed. Try again in a minute.");
  const bAnswers = db.select().from(answers).where(eq(answers.testimonialId, b.id)).orderBy(asc(answers.position)).all();
  if (bAnswers.some((x) => busy(x.mediaStatus) || busy(x.transcriptStatus))) throw new MergeError(409, "One of its answer videos is still being processed. Try again in a minute.");

  const now = new Date();
  const bTags = getTestimonial(b.id)?.tags ?? [];
  const aTags = getTestimonial(a.id)?.tags ?? [];
  const bEvents = listConsentEvents(b.id);
  const imagesPublic = wasPublicUnder(b, a);

  db.transaction((tx) => {
    const usedKeys = new Set(tx.select({ k: answers.questionKey }).from(answers).where(eq(answers.testimonialId, a.id)).all().map((r) => r.k));
    let position = tx.select({ p: max(answers.position) }).from(answers).where(eq(answers.testimonialId, a.id)).get()?.p ?? 0;
    const freeKey = (wanted: string) => {
      let key = wanted.slice(0, KEY_MAX);
      for (let n = 2; usedKeys.has(key); n++) key = `${wanted.slice(0, KEY_MAX - String(n).length - 1)}-${n}`;
      usedKeys.add(key);
      return key;
    };
    const answerIds = new Map<string | null, string>();

    // B's main text or video: an extra answer on A.
    if (b.text || b.videoKey) {
      const id = crypto.randomUUID();
      answerIds.set(null, id);
      tx.insert(answers)
        .values({
          id,
          testimonialId: a.id,
          questionKey: freeKey(`merged-${b.id.slice(0, 8)}`),
          questionTitle: (b.headline || b.primaryQuestion || "Their other testimonial").slice(0, 300),
          position: ++position,
          text: b.text,
          videoKey: b.videoKey,
          videoMime: b.videoMime,
          videoOriginalKey: b.videoOriginalKey,
          posterKey: b.posterKey,
          videoDurationMs: b.videoDurationMs,
          videoWidth: b.videoWidth,
          videoHeight: b.videoHeight,
          mediaStatus: b.mediaStatus,
          mediaError: b.mediaError,
          transcript: b.transcript,
          captionsVtt: b.captionsVtt,
          transcriptStatus: b.transcriptStatus,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    // B's other answers, after A's.
    for (const ans of bAnswers) {
      const id = crypto.randomUUID();
      answerIds.set(ans.id, id);
      tx.insert(answers)
        .values({ ...ans, id, testimonialId: a.id, questionKey: freeKey(ans.questionKey), position: ++position, createdAt: now, updatedAt: now })
        .run();
    }
    // Highlights stay on the same words, now in the copies.
    for (const h of tx.select().from(highlights).where(eq(highlights.testimonialId, b.id)).all()) {
      const answerId = answerIds.get(h.answerId);
      if (!answerId) continue;
      tx.insert(highlights).values({ ...h, id: crypto.randomUUID(), testimonialId: a.id, answerId, createdAt: now }).run();
    }
    // Images join A's; owner-only unless B was public under A's consent.
    let imagePos = tx.select({ p: max(testimonialImages.position) }).from(testimonialImages).where(eq(testimonialImages.testimonialId, a.id)).get()?.p ?? 0;
    for (const img of tx.select().from(testimonialImages).where(eq(testimonialImages.testimonialId, b.id)).orderBy(asc(testimonialImages.position)).all()) {
      tx.insert(testimonialImages)
        .values({ ...img, id: crypto.randomUUID(), testimonialId: a.id, position: ++imagePos, ownerOnly: img.ownerOnly || !imagesPublic, createdAt: now })
        .run();
    }
    // Tags: the union, up to the usual 20.
    const union = [...new Set([...aTags, ...bTags])].slice(0, MAX_TAGS);
    for (const name of union.filter((t) => !aTags.includes(t))) {
      const tag = tx.select().from(tags).where(and(eq(tags.projectId, projectId), eq(tags.name, name))).get();
      if (tag) tx.insert(testimonialTags).values({ testimonialId: a.id, tagId: tag.id }).onConflictDoNothing().run();
    }
    // B's consent ledger, copied onto A's (B keeps its own; rows are only ever added).
    for (const e of bEvents) {
      tx.insert(consentEvents)
        .values({
          ...e,
          id: crypto.randomUUID(),
          testimonialId: a.id,
          detail: `From merged testimonial ${b.id}${e.detail ? `: ${e.detail}` : ""}`.slice(0, 2000),
        })
        .run();
    }
    refreshWordCount(tx, a.id);
    tx.update(testimonials).set({ updatedAt: now }).where(eq(testimonials.id, a.id)).run();
    recordHistory(tx, {
      testimonialId: a.id,
      actor: "owner",
      actorEmail: o.by,
      action: "merged",
      diff: { merged: [null, b.id], from: [null, b.authorName], tags: [aTags, union] },
      at: now,
    });
    // B: to the trash, marked as merged. Restore brings it back to Pending, so nothing reappears on its own.
    tx.update(testimonials)
      .set({ status: "trashed", trashedAt: now, statusBeforeTrash: "pending", mergedIntoId: a.id, updatedAt: now })
      .where(eq(testimonials.id, b.id))
      .run();
    recordHistory(tx, {
      testimonialId: b.id,
      actor: "owner",
      actorEmail: o.by,
      action: "merged",
      diff: { status: [b.status, "trashed"], mergedInto: [null, a.id] },
      at: now,
    });
  });
  const into = getTestimonial(a.id)!;
  const from = getTestimonial(b.id)!;
  emitTestimonialEvent("testimonial.updated", into);
  emitTestimonialEvent("testimonial.trashed", from);
  return { into, from };
}

/** For the drawer: what a merged testimonial was merged into, if that one still exists. */
export function mergedInto(t: Pick<Testimonial, "mergedIntoId">) {
  if (!t.mergedIntoId) return null;
  return getDb().select({ id: testimonials.id, authorName: testimonials.authorName, status: testimonials.status }).from(testimonials).where(eq(testimonials.id, t.mergedIntoId)).get() ?? null;
}

/** Every testimonial that has a likely duplicate (the inbox's "Possible duplicates" filter). */
export function withDuplicates(projectId: string): string[] {
  return [...duplicateMap(projectId).keys()];
}

