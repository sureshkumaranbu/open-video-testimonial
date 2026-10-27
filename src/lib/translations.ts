import crypto from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Translation } from "@/db/schema";
import { recordHistory } from "./history";
import { enqueue, PermanentJobError, registerJob } from "./jobs";
import { getTestimonial } from "./testimonials";
import { translateTexts, translationEnabled } from "./translate";
import type { FeedItem } from "./widget-config";

const { translations, testimonials } = schema;

/**
 * Translations (INBOX-13): a testimonial's headline and text in other
 * languages, written by the owner or by their own provider (`machine`).
 * The author's own words are never changed; a translation is shown instead
 * only where asked: a widget set to the visitor's language, for public rows,
 * when one exists. Public pages never call the provider.
 */

export const TRANSLATE_JOB = "translations.machine";
export const MAX_TRANSLATIONS = 30;

/** Lower-case BCP 47: "fr", "pt-br", "zh-hant". */
export const langSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/, "Use a language code such as fr or pt-br");

/** A visitor's language from the browser (navigator.language), or null when it isn't one. */
export function visitorLang(raw: string | null | undefined): string | null {
  const parsed = langSchema.safeParse((raw ?? "").replace(/_/g, "-").slice(0, 35));
  return parsed.success ? parsed.data : null;
}

export const translationBody = z.object({
  headline: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  text: z.string().trim().max(10_000).nullable().optional().transform((v) => v || null),
});

export class TranslationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function listTranslations(testimonialId: string): Translation[] {
  return getDb().select().from(translations).where(eq(translations.testimonialId, testimonialId)).orderBy(asc(translations.lang)).all();
}

/** Adds or replaces one language. A hand-written one is never overwritten by a machine one (`keepHuman`). */
export function saveTranslation(
  testimonialId: string,
  lang: string,
  value: { headline: string | null; text: string | null },
  o: { machine?: boolean; by?: string; keepHuman?: boolean } = {},
): Translation | null {
  const db = getDb();
  const t = db.select({ id: testimonials.id, language: testimonials.language }).from(testimonials).where(eq(testimonials.id, testimonialId)).get();
  if (!t) throw new TranslationError(404, "Testimonial not found");
  const code = langSchema.parse(lang);
  if (!value.headline && !value.text) throw new TranslationError(400, "Add the translated text");
  const existing = db.select().from(translations).where(and(eq(translations.testimonialId, testimonialId), eq(translations.lang, code))).get();
  if (existing && o.keepHuman && !existing.machine) return existing;
  if (!existing && db.select({ id: translations.id }).from(translations).where(eq(translations.testimonialId, testimonialId)).all().length >= MAX_TRANSLATIONS) {
    throw new TranslationError(400, `A testimonial can have at most ${MAX_TRANSLATIONS} translations`);
  }
  const now = new Date();
  return db.transaction((tx) => {
    const row = existing
      ? tx.update(translations).set({ headline: value.headline, text: value.text, machine: Boolean(o.machine), updatedAt: now }).where(eq(translations.id, existing.id)).returning().get()!
      : tx
          .insert(translations)
          .values({ id: crypto.randomUUID(), testimonialId, lang: code, headline: value.headline, text: value.text, machine: Boolean(o.machine), createdAt: now, updatedAt: now })
          .returning()
          .get();
    recordHistory(tx, {
      testimonialId,
      actor: o.machine ? "system" : "owner",
      actorEmail: o.by,
      action: "translation",
      diff: { [`translation:${code}`]: [existing?.text ?? null, value.text] },
      at: now,
    });
    return row;
  });
}

export function deleteTranslation(testimonialId: string, lang: string, o: { by?: string } = {}): boolean {
  const db = getDb();
  const code = langSchema.parse(lang);
  return db.transaction((tx) => {
    const gone = tx.delete(translations).where(and(eq(translations.testimonialId, testimonialId), eq(translations.lang, code))).returning().get();
    if (!gone) return false;
    recordHistory(tx, { testimonialId, actor: "owner", actorEmail: o.by, action: "translation", diff: { [`translation:${code}`]: [gone.text, null] } });
    return true;
  });
}

/** Translates one testimonial into `lang` with the owner's provider now, and saves it as a machine translation. */
export async function machineTranslate(testimonialId: string, lang: string, o: { by?: string; keepHuman?: boolean } = {}): Promise<Translation | null> {
  const t = getTestimonial(testimonialId);
  if (!t) throw new TranslationError(404, "Testimonial not found");
  if (!translationEnabled()) throw new TranslationError(409, "Translation isn't set up on this server. Set TRANSLATE_PROVIDER and its key, or write the translation yourself.");
  const code = langSchema.parse(lang);
  if (!t.text && !t.headline) throw new TranslationError(400, "There's no text to translate (a video without a transcript, say)");
  const [headline, text] = await translateTexts([t.headline ?? "", t.text ?? ""], code, t.language);
  return saveTranslation(testimonialId, code, { headline: headline || null, text: text || null }, { machine: true, by: o.by, keepHuman: o.keepHuman });
}

/** Queues machine translations into these languages (the testimonial's own language is skipped). Nothing happens without a provider. */
export function queueTranslations(testimonialId: string, langs: string[], o: { by?: string } = {}): boolean {
  if (!translationEnabled()) return false;
  const codes = [...new Set(langs.map((l) => langSchema.safeParse(l)).filter((r) => r.success).map((r) => r.data!))];
  if (!codes.length) return false;
  enqueue(TRANSLATE_JOB, { testimonialId, langs: codes, by: o.by ?? null }, { maxAttempts: 4 });
  return true;
}

/** The job: one testimonial into each language, keeping hand-written ones. Deleted rows are skipped. */
export async function runTranslateJob(p: { testimonialId: string; langs: string[]; by?: string | null }) {
  const t = getTestimonial(p.testimonialId);
  if (!t || (!t.text && !t.headline)) return;
  const own = (t.language ?? "").toLowerCase();
  for (const lang of p.langs) {
    if (own && (own === lang || own.split("-")[0] === lang)) continue;
    try {
      await machineTranslate(t.id, lang, { by: p.by ?? undefined, keepHuman: true });
    } catch (err) {
      // Nothing to translate, or no provider any more: retrying won't help. A provider error is retried.
      if (err instanceof TranslationError) throw new PermanentJobError(err.message);
      throw err;
    }
  }
}

export function registerTranslationJobs(): void {
  registerJob(TRANSLATE_JOB, async (payload) => {
    await runTranslateJob(payload as Parameters<typeof runTranslateJob>[0]);
  });
}

/**
 * Widgets set to "the visitor's language": the translation into `lang` (or
 * its base language, "fr" for "fr-ca") replaces the headline and text of the
 * public rows that have one. Highlights point into the original words, so a
 * translated item has none. Rows already in that language are left alone.
 */
export function applyTranslations(items: FeedItem[], lang: string | null, own: Map<string, string | null> = new Map()): FeedItem[] {
  if (!lang || !items.length) return items;
  const base = lang.split("-")[0];
  const rows = getDb()
    .select()
    .from(translations)
    .where(and(inArray(translations.testimonialId, items.map((i) => i.id)), inArray(translations.lang, [...new Set([lang, base])])))
    .all();
  if (!rows.length) return items;
  const best = new Map<string, Translation>();
  for (const r of rows) if (!best.has(r.testimonialId) || r.lang === lang) best.set(r.testimonialId, r);
  return items.map((item) => {
    const tr = best.get(item.id);
    const original = (own.get(item.id) ?? "").toLowerCase();
    if (!tr || (original && (original === lang || original.split("-")[0] === base))) return item;
    return {
      ...item,
      text: tr.text ?? item.text,
      extra: { ...item.extra, headline: tr.headline ?? item.extra.headline, highlights: tr.text ? [] : item.extra.highlights },
    };
  });
}

/** The original language of these testimonials, for applyTranslations. */
export function languagesOf(ids: string[]): Map<string, string | null> {
  if (!ids.length) return new Map();
  return new Map(getDb().select({ id: testimonials.id, language: testimonials.language }).from(testimonials).where(inArray(testimonials.id, ids)).all().map((r) => [r.id, r.language]));
}
