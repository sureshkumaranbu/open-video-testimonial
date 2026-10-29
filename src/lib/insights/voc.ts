import { and, desc, eq, gte, inArray, isNotNull, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { AiError, aiForProject, aiJson, trimForAi } from "../ai";
import { embeddingsEnabled, ProviderError, rankBySimilarity } from "../embeddings";
import { featureOn } from "../features";
import { keywordInsights, STOPWORDS, tokenize, type Doc, type KeywordInsights } from "./text";

const { testimonials, testimonialTags, tags, surveyResponses } = schema;

/**
 * VOC-01 Voice of Customer: what a project's testimonials (or survey
 * comments, NPS-01) say over a date range and tags. Always available:
 *   - a rating breakdown and a sentiment split read from the stars (4–5
 *     positive, 3 neutral, 1–2 negative; survey scores 9–10, 7–8, 0–6);
 *   - the words and phrases most of them share, counted from the inbox's
 *     own full-text index (src/lib/insights/text.ts), with "what they love"
 *     from the happy ones and "what to improve" from the rest.
 * With AI on for the project, "Find themes with AI" sends a capped sample
 * (at most 60 testimonials, 500 characters each, 12,000 in all; only their
 * words and ratings, never names or emails) and gets named themes back,
 * each citing the testimonials it came from. Ask a question finds the
 * testimonials that answer it (smart search when it's on, else keywords)
 * and, with AI, writes a short answer that cites them; without AI it
 * returns the testimonials alone.
 */

export class InsightsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Rows a report reads at most, newest first. */
export const MAX_ROWS = 2000;
/** What one AI themes call may send. */
const AI_SAMPLE = 60;
const AI_ITEM_CHARS = 500;
const AI_TOTAL_CHARS = 12_000;
/** Testimonials an answer may cite. */
const ASK_RESULTS = 8;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use dates like 2026-01-31");
export const insightFiltersSchema = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(10).default([]),
  /** NPS-01: survey comments instead of testimonials. */
  source: z.enum(["testimonials", "survey"]).default("testimonials"),
  /** Survey comments of one form only. */
  formId: z.string().max(64).optional(),
});
export type InsightFilters = z.output<typeof insightFiltersSchema>;

const DAY = 86_400_000;
const range = (f: Pick<InsightFilters, "from" | "to">) => ({
  from: f.from ? new Date(`${f.from}T00:00:00Z`) : null,
  // `to` is a whole day.
  to: f.to ? new Date(Date.parse(`${f.to}T00:00:00Z`) + DAY) : null,
});

export type InsightRow = {
  id: string;
  name: string;
  company: string | null;
  /** 1–5 stars for testimonials, 0–10 for survey answers. */
  rating: number | null;
  words: string;
  createdAt: Date;
};

/** The testimonials a report covers: not trashed or rejected, in the range and (if given) with any of the tags. */
function testimonialRows(projectId: string, f: InsightFilters): InsightRow[] {
  const { from, to } = range(f);
  const where: SQL[] = [eq(testimonials.projectId, projectId), notInArray(testimonials.status, ["trashed", "rejected"])];
  if (from) where.push(gte(testimonials.createdAt, from));
  if (to) where.push(lt(testimonials.createdAt, to));
  if (f.tags.length) {
    where.push(
      inArray(
        testimonials.id,
        getDb()
          .select({ id: testimonialTags.testimonialId })
          .from(testimonialTags)
          .innerJoin(tags, eq(tags.id, testimonialTags.tagId))
          .where(and(eq(tags.projectId, projectId), inArray(tags.name, f.tags))),
      ),
    );
  }
  return getDb()
    .select({ id: testimonials.id, name: testimonials.authorName, company: testimonials.authorCompany, rating: testimonials.rating, headline: testimonials.headline, text: testimonials.text, transcript: testimonials.transcript, createdAt: testimonials.createdAt })
    .from(testimonials)
    .where(and(...where))
    .orderBy(desc(testimonials.createdAt))
    .limit(MAX_ROWS)
    .all()
    .map((r) => ({ id: r.id, name: r.name, company: r.company, rating: r.rating, words: [r.headline, r.text, r.transcript].filter(Boolean).join("\n"), createdAt: r.createdAt }));
}

/** NPS-01: survey answers with a comment, as rows. */
function surveyRows(projectId: string, f: InsightFilters): InsightRow[] {
  const { from, to } = range(f);
  const where: SQL[] = [eq(surveyResponses.projectId, projectId), isNotNull(surveyResponses.comment)];
  if (from) where.push(gte(surveyResponses.createdAt, from));
  if (to) where.push(lt(surveyResponses.createdAt, to));
  if (f.formId) where.push(eq(surveyResponses.formId, f.formId));
  return getDb()
    .select()
    .from(surveyResponses)
    .where(and(...where))
    .orderBy(desc(surveyResponses.createdAt))
    .limit(MAX_ROWS)
    .all()
    .filter((r) => r.comment?.trim())
    .map((r) => ({ id: r.id, name: r.authorName || "Anonymous", company: null, rating: r.score, words: r.comment ?? "", createdAt: r.createdAt }));
}

export function insightRows(projectId: string, f: InsightFilters): InsightRow[] {
  return f.source === "survey" ? surveyRows(projectId, f) : testimonialRows(projectId, f);
}

type Sentiment = "positive" | "neutral" | "negative";
function sentimentOf(rating: number | null, source: InsightFilters["source"]): Sentiment | null {
  if (rating == null) return null;
  if (source === "survey") return rating >= 9 ? "positive" : rating >= 7 ? "neutral" : "negative";
  return rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";
}

/** The rating and sentiment breakdown. */
export function breakdown(rows: InsightRow[], source: InsightFilters["source"]) {
  const rated = rows.filter((r) => r.rating != null);
  const scale = source === "survey" ? 11 : 5;
  const ratings = Array.from({ length: scale }, (_, i) => {
    const value = source === "survey" ? i : i + 1;
    return { value, count: rated.filter((r) => r.rating === value).length };
  });
  const sentiment = { positive: 0, neutral: 0, negative: 0, unrated: rows.length - rated.length };
  for (const r of rated) sentiment[sentimentOf(r.rating, source)!]++;
  return {
    count: rows.length,
    rated: rated.length,
    average: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating!, 0) / rated.length) * 10) / 10 : null,
    ratings,
    sentiment,
  };
}

/** Names, companies and tags never count as words: they'd only say who wrote in. */
function identityWords(projectId: string, rows: InsightRow[]): Set<string> {
  const skip = new Set<string>();
  for (const r of rows) for (const w of [...tokenize(r.name), ...tokenize(r.company)]) skip.add(w);
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      for (const p of getDb().select({ email: testimonials.authorEmail, title: testimonials.authorTitle }).from(testimonials).where(inArray(testimonials.id, ids.slice(i, i + 500))).all()) {
        for (const w of [...tokenize(p.email), ...tokenize(p.title)]) skip.add(w);
      }
    }
  }
  for (const t of getDb().select({ name: tags.name }).from(tags).where(eq(tags.projectId, projectId)).all()) for (const w of tokenize(t.name)) skip.add(w);
  return skip;
}

/** Each testimonial's words as the FTS index holds them, in order (read through the fts5vocab view, 500 at a time). */
function indexedTokens(rows: InsightRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const hits = getDb().all<{ testimonialId: string; term: string; offset: number }>(sql`
      SELECT s.testimonial_id AS testimonialId, v.term AS term, v.offset AS offset
      FROM testimonials_fts_vocab v JOIN testimonial_search s ON s.id = v.doc
      WHERE s.testimonial_id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
      ORDER BY s.testimonial_id, v.offset`);
    for (const h of hits) {
      let list = out.get(h.testimonialId);
      if (!list) out.set(h.testimonialId, (list = []));
      list[h.offset] = h.term;
    }
  }
  // Holes (none in practice) would join words that weren't next to each other.
  for (const [id, list] of out) out.set(id, Array.from(list, (w) => w ?? ""));
  return out;
}

export type VocReport = {
  filters: InsightFilters;
  breakdown: ReturnType<typeof breakdown>;
  keywords: KeywordInsights;
  /** VOC-01 with AI; null until asked for. */
  themes: AiThemes | null;
  /** Who wrote what, for the citations. */
  cited: Record<string, { name: string; company: string | null; rating: number | null; excerpt: string }>;
  truncated: boolean;
};

const excerpt = (s: string, n = 200) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

function citations(rows: InsightRow[], ids: Iterable<string>): VocReport["cited"] {
  const want = new Set(ids);
  return Object.fromEntries(rows.filter((r) => want.has(r.id)).map((r) => [r.id, { name: r.name, company: r.company, rating: r.rating, excerpt: excerpt(r.words) }]));
}

/** VOC-01 without AI: the breakdown and the counted words and phrases. */
export function vocReport(projectId: string, filters: InsightFilters): VocReport {
  const rows = insightRows(projectId, filters);
  const skip = identityWords(projectId, rows);
  const tokens = filters.source === "testimonials" ? indexedTokens(rows) : null;
  const docs: Doc[] = rows.map((r) => {
    const s = sentimentOf(r.rating, filters.source);
    // An indexed body also holds the person's name, title, tags and answers; the skip list keeps those out.
    return { id: r.id, tokens: tokens?.get(r.id) ?? tokenize(r.words), group: s === "positive" ? "love" : s === "negative" || s === "neutral" ? "improve" : null };
  });
  const keywords = keywordInsights(docs, skip);
  const ids = [...keywords.words, ...keywords.phrases, ...keywords.love, ...keywords.improve].flatMap((k) => k.ids);
  return { filters, breakdown: breakdown(rows, filters.source), keywords, themes: null, cited: citations(rows, ids), truncated: rows.length >= MAX_ROWS };
}

// ------------------------------------------------------------------ with AI

const refList = z.array(z.string().max(12)).max(20).catch([]);
const aiThemesSchema = z.object({
  summary: z.string().trim().max(1000).catch(""),
  themes: z
    .array(z.object({ name: z.string().trim().min(1).max(80), summary: z.string().trim().max(500).catch(""), sentiment: z.enum(["positive", "negative", "mixed"]).catch("mixed"), refs: refList }).nullable().catch(null))
    .max(12)
    .catch([]),
  love: z.array(z.object({ point: z.string().trim().min(1).max(200), refs: refList }).nullable().catch(null)).max(8).catch([]),
  improve: z.array(z.object({ point: z.string().trim().min(1).max(200), refs: refList }).nullable().catch(null)).max(8).catch([]),
});
export type AiThemes = {
  summary: string;
  themes: { name: string; summary: string; sentiment: "positive" | "negative" | "mixed"; ids: string[] }[];
  love: { point: string; ids: string[] }[];
  improve: { point: string; ids: string[] }[];
  /** How many of the report's rows were sent. */
  sampled: number;
};

const THEMES_SYSTEM = [
  "You analyse customer feedback for a business. You get numbered items (T1, T2…) with a rating and the customer's words. Answer with only a JSON object, no prose:",
  '{"summary": string, "themes": [{"name": string, "summary": string, "sentiment": "positive"|"negative"|"mixed", "refs": ["T1"]}], "love": [{"point": string, "refs": ["T2"]}], "improve": [{"point": string, "refs": ["T3"]}]}',
  "themes: at most 6 recurring topics, each citing every item that mentions it. love: what customers praise. improve: what they ask for or complain about. Only use what the items say; cite at least one item for every point.",
].join("\n");

/** Spread evenly over the rows (newest first), so a sample covers the whole range rather than the last week. */
function sample<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  return Array.from({ length: n }, (_, i) => rows[Math.floor((i * rows.length) / n)]);
}

/** Turns "T3" references back into ids, dropping any that weren't sent. */
const resolve = (refs: string[], map: Map<string, string>) => [...new Set(refs.map((r) => map.get(r.trim().toUpperCase())).filter((v): v is string => Boolean(v)))];

/** VOC-01 "Find themes with AI". InsightsError 409 when AI is off for the project, 502 when the provider fails. */
export async function vocThemes(project: Project, filters: InsightFilters): Promise<VocReport> {
  if (!aiForProject(project)) throw new InsightsError(409, "AI isn't on for this project. The words and phrases above are counted without it.");
  const report = vocReport(project.id, filters);
  const rows = insightRows(project.id, filters).filter((r) => r.words.trim());
  if (!rows.length) throw new InsightsError(409, "There's nothing to read in this range yet");
  const map = new Map<string, string>();
  const lines: string[] = [];
  let total = 0;
  for (const r of sample(rows, AI_SAMPLE)) {
    const ref = `T${map.size + 1}`;
    const line = `${ref} (${r.rating == null ? "no rating" : filters.source === "survey" ? `score ${r.rating}/10` : `${r.rating}/5`}): ${trimForAi(r.words, AI_ITEM_CHARS)}`;
    if (total + line.length > AI_TOTAL_CHARS) break;
    total += line.length + 1;
    map.set(ref, r.id);
    lines.push(line);
  }
  let a: z.infer<typeof aiThemesSchema>;
  try {
    a = await aiJson({ system: THEMES_SYSTEM, user: lines.join("\n"), schema: aiThemesSchema, maxTokens: 1500, timeoutMs: 45_000 });
  } catch (err) {
    if (err instanceof AiError) throw new InsightsError(502, err.message);
    throw err;
  }
  const themes: AiThemes = {
    summary: a.summary,
    themes: a.themes.flatMap((t) => (t ? [{ name: t.name, summary: t.summary, sentiment: t.sentiment, ids: resolve(t.refs, map) }] : [])).filter((t) => t.ids.length),
    love: a.love.flatMap((t) => (t ? [{ point: t.point, ids: resolve(t.refs, map) }] : [])).filter((t) => t.ids.length),
    improve: a.improve.flatMap((t) => (t ? [{ point: t.point, ids: resolve(t.refs, map) }] : [])).filter((t) => t.ids.length),
    sampled: map.size,
  };
  const ids = [...themes.themes, ...themes.love, ...themes.improve].flatMap((t) => t.ids);
  return { ...report, themes, cited: { ...report.cited, ...citations(rows, ids) } };
}

// ------------------------------------------------------------------ ask a question

export type AskResult = {
  question: string;
  filters: InsightFilters;
  /** How the testimonials were found. */
  method: "smart-search" | "keywords";
  matches: { id: string; name: string; company: string | null; rating: number | null; excerpt: string; date: string }[];
  /** With AI: a short answer, and the matches it cites. */
  answer: string | null;
  cited: string[];
  /** Why there's no answer, when there isn't one. */
  note: string | null;
};

/** The question's words as an FTS5 query: any of them (quoted, as prefixes), common words left out. */
export function questionQuery(question: string): string | null {
  const words = [...new Set(tokenize(question).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))].slice(0, 12);
  return words.length ? words.map((w) => `"${w}"*`).join(" OR ") : null;
}

const askSchema = z.object({ answer: z.string().trim().max(2000).catch(""), refs: refList });

const ASK_SYSTEM = [
  "You answer a business owner's question using only the customer feedback items given (T1, T2…). Answer with only a JSON object, no prose:",
  '{"answer": string, "refs": ["T1"]}',
  "answer: two to four plain sentences. Say so if the items don't answer the question. refs: every item the answer relies on.",
].join("\n");

/** VOC-01 ask a question. `summarize` (an editor with AI on) adds the answer; otherwise the testimonials alone. */
export async function askQuestion(project: Project, rawQuestion: string, filters: InsightFilters, o: { summarize: boolean }): Promise<AskResult> {
  const question = rawQuestion.trim().slice(0, 300);
  if (!question) throw new InsightsError(400, "Type a question");
  const rows = insightRows(project.id, { ...filters, source: "testimonials" });
  const byId = new Map(rows.map((r) => [r.id, r]));
  let method: AskResult["method"] = "keywords";
  let ids: string[] = [];
  if (featureOn("aisearch") && embeddingsEnabled() && rows.length) {
    try {
      ids = (await rankBySimilarity(project.id, question, new Set(byId.keys()))).slice(0, ASK_RESULTS).map((r) => r.id);
      method = "smart-search";
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
    }
  }
  if (method === "keywords") {
    const fts = questionQuery(question);
    if (fts) {
      const hits = getDb().all<{ id: string }>(sql`
        SELECT s.testimonial_id AS id FROM testimonials_fts
        JOIN testimonial_search s ON s.id = testimonials_fts.rowid
        WHERE testimonials_fts MATCH ${fts} AND s.project_id = ${project.id}
        ORDER BY bm25(testimonials_fts) LIMIT 200`);
      ids = hits.map((h) => h.id).filter((id) => byId.has(id)).slice(0, ASK_RESULTS);
    }
  }
  const matches = ids.map((id) => {
    const r = byId.get(id)!;
    return { id, name: r.name, company: r.company, rating: r.rating, excerpt: excerpt(r.words, 280), date: r.createdAt.toISOString().slice(0, 10) };
  });
  const result: AskResult = { question, filters, method, matches, answer: null, cited: [], note: null };
  if (!matches.length) return { ...result, note: "No testimonials match this question in the range." };
  if (!aiForProject(project)) return { ...result, note: "These are the testimonials that match. With AI on, a short answer that cites them appears here." };
  if (!o.summarize) return { ...result, note: "Your role shows the matching testimonials; an editor can ask for an AI answer." };
  const map = new Map<string, string>();
  const lines = matches.map((m, i) => {
    map.set(`T${i + 1}`, m.id);
    return `T${i + 1} (${m.rating == null ? "no rating" : `${m.rating}/5`}): ${trimForAi(byId.get(m.id)!.words, 600)}`;
  });
  try {
    const a = await aiJson({ system: ASK_SYSTEM, user: `Question: ${trimForAi(question, 300)}\n\n${lines.join("\n")}`, schema: askSchema, maxTokens: 600 });
    return { ...result, answer: a.answer || null, cited: resolve(a.refs, map) };
  } catch (err) {
    if (err instanceof AiError) return { ...result, note: `The AI answer failed (${err.message}); here are the matching testimonials.` };
    throw err;
  }
}
