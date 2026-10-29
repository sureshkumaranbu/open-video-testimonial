import crypto from "node:crypto";
import { and, asc, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Tx } from "@/db";

const { surveyResponses, forms } = schema;

/**
 * NPS-01: Net Promoter Score from forms' NPS questions (0–10 and why).
 * Promoters score 9–10, passives 7–8, detractors 0–6; the score is the
 * share of promoters minus the share of detractors, from −100 to 100.
 * Answers live in survey_responses: private, never on a public page, and
 * linked to a testimonial only when a promoter chose to write one.
 */

export type NpsGroup = "promoter" | "passive" | "detractor";
export const npsGroup = (score: number): NpsGroup => (score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor");

/** The score for these answers, or null with none. */
export function npsScore(scores: number[]): number | null {
  if (!scores.length) return null;
  const p = scores.filter((s) => s >= 9).length;
  const d = scores.filter((s) => s <= 6).length;
  return Math.round(((p - d) / scores.length) * 100);
}

export type NewSurveyAnswer = { key: string; score: number; why?: string | null };

/** Stores a submission's NPS answers inside its transaction. */
export function insertSurveyResponses(
  tx: Tx,
  o: { projectId: string; formId: string | null; testimonialId: string | null; name?: string | null; email?: string | null; answers: NewSurveyAnswer[] },
) {
  if (!o.answers.length) return [];
  const now = new Date();
  return tx
    .insert(surveyResponses)
    .values(
      o.answers.map((a) => ({
        id: crypto.randomUUID(),
        projectId: o.projectId,
        formId: o.formId,
        testimonialId: o.testimonialId,
        questionKey: a.key,
        score: a.score,
        comment: a.why?.trim() || null,
        authorName: o.name?.trim() || null,
        authorEmail: o.email?.trim() || null,
        createdAt: now,
      })),
    )
    .returning()
    .all();
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use dates like 2026-01-31");
export const npsFiltersSchema = z.object({ from: ymd.optional(), to: ymd.optional(), formId: z.string().max(64).optional() });
export type NpsFilters = z.output<typeof npsFiltersSchema>;

const DAY = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** The Monday of a date's week (UTC). */
const weekOf = (d: Date) => dayOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))));

/**
 * The NPS dashboard: the score, the three groups, a trend (per day for a
 * month or less, else per week) and the latest 100 comments.
 */
export function npsSummary(projectId: string, f: NpsFilters) {
  const where: SQL[] = [eq(surveyResponses.projectId, projectId)];
  const from = f.from ? new Date(`${f.from}T00:00:00Z`) : null;
  const to = f.to ? new Date(Date.parse(`${f.to}T00:00:00Z`) + DAY) : null;
  if (from) where.push(gte(surveyResponses.createdAt, from));
  if (to) where.push(lt(surveyResponses.createdAt, to));
  if (f.formId) where.push(eq(surveyResponses.formId, f.formId));
  const rows = getDb().select().from(surveyResponses).where(and(...where)).orderBy(asc(surveyResponses.createdAt)).all();
  const scores = rows.map((r) => r.score);
  const first = from ?? rows[0]?.createdAt ?? null;
  const last = to ? new Date(to.getTime() - 1) : (rows.at(-1)?.createdAt ?? null);
  const weekly = first && last ? last.getTime() - first.getTime() > 31 * DAY : false;
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const k = weekly ? weekOf(r.createdAt) : dayOf(r.createdAt);
    buckets.set(k, [...(buckets.get(k) ?? []), r.score]);
  }
  const formNames = new Map(getDb().select({ id: forms.id, name: forms.name }).from(forms).where(eq(forms.projectId, projectId)).all().map((x) => [x.id, x.name]));
  return {
    filters: f,
    responses: rows.length,
    score: npsScore(scores),
    promoters: scores.filter((s) => s >= 9).length,
    passives: scores.filter((s) => s >= 7 && s <= 8).length,
    detractors: scores.filter((s) => s <= 6).length,
    distribution: Array.from({ length: 11 }, (_, i) => ({ value: i, count: scores.filter((s) => s === i).length })),
    trend: { by: weekly ? ("week" as const) : ("day" as const), points: [...buckets.entries()].map(([period, s]) => ({ period, responses: s.length, score: npsScore(s)! })) },
    comments: rows
      .filter((r) => r.comment)
      .reverse()
      .slice(0, 100)
      .map((r) => ({ id: r.id, score: r.score, group: npsGroup(r.score), comment: r.comment!, name: r.authorName, date: dayOf(r.createdAt), testimonialId: r.testimonialId, form: r.formId ? (formNames.get(r.formId) ?? null) : null })),
  };
}
export type NpsSummary = ReturnType<typeof npsSummary>;

/** The forms with NPS answers, for the dashboard's form filter. */
export function npsForms(projectId: string) {
  const ids = new Set(getDb().select({ id: surveyResponses.formId }).from(surveyResponses).where(eq(surveyResponses.projectId, projectId)).orderBy(desc(surveyResponses.createdAt)).limit(5000).all().map((r) => r.id).filter(Boolean));
  return getDb().select({ id: forms.id, name: forms.name, kind: forms.kind }).from(forms).where(eq(forms.projectId, projectId)).all().filter((f) => ids.has(f.id) || f.kind === "survey");
}
