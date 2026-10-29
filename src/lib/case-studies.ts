import crypto from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { CaseStudy, Project } from "@/db/schema";
import { AiError, aiForProject, aiJson, quotedFrom, trimForAi } from "./ai";
import { listAnswers } from "./answers";
import { env } from "./env";
import { listHighlights } from "./highlights";
import { toFeedItems } from "./public-feed";
import { hasPublicPage } from "./testimonial-page";
import { getProjectById, getTestimonial, type TestimonialWithTags } from "./testimonials";
import type { FeedItem } from "./widget-config";

const { caseStudies, testimonials } = schema;

/**
 * SHARE-04 case studies: a customer story made from one testimonial, with a
 * title, the challenge, the solution, the result, a pull quote and up to
 * four metrics. Without AI it starts as a template (the person, a pull quote
 * from the testimonial's highlights or first sentence, empty sections with
 * prompts) that the owner fills in. With AI on for the project, "Draft with
 * AI" sends the testimonial's own words (text, transcript and answers,
 * trimmed and capped) to the owner's provider and fills the fields; the
 * owner edits before saving. The pull quote must be the customer's own words
 * and every metric's number must appear in them, or it's dropped, so
 * nothing is made up.
 *
 * A published case study has a public page (/cs/<id>) and a PDF, both only
 * while the testimonial may have a public page (approved, not withdrawn,
 * public consent; src/lib/testimonial-page.ts). Anything else answers 404.
 */

export class CaseStudyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_METRICS = 4;

const section = z.string().max(3000).default("");
export const metricSchema = z.object({ value: z.string().trim().min(1).max(24), label: z.string().trim().min(1).max(80) });
export const caseStudyContentSchema = z.object({
  /** One or two sentences under the title. */
  summary: z.string().max(500).default(""),
  challenge: section,
  solution: section,
  result: section,
  /** The customer's own words. */
  pullQuote: z.string().max(600).default(""),
  metrics: z.array(metricSchema).max(MAX_METRICS).default([]),
});
export type CaseStudyContent = z.infer<typeof caseStudyContentSchema>;

export const caseStudyInputSchema = z.object({
  title: z.string().trim().min(1, "Give the case study a title").max(160),
  status: z.enum(["draft", "published"]).optional(),
  content: caseStudyContentSchema.prefault({}),
  /** The fields came from "Draft with AI" (recorded, so the editor can say so). */
  aiDrafted: z.boolean().optional(),
});
export type CaseStudyInput = z.input<typeof caseStudyInputSchema>;

export function parseContent(raw: string | null | undefined): CaseStudyContent {
  try {
    const parsed = caseStudyContentSchema.safeParse(JSON.parse(raw || "{}"));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  return caseStudyContentSchema.parse({});
}

export function getCaseStudy(id: string): CaseStudy | null {
  return getDb().select().from(caseStudies).where(eq(caseStudies.id, id)).get() ?? null;
}

export function listCaseStudies(projectId: string): CaseStudy[] {
  return getDb().select().from(caseStudies).where(eq(caseStudies.projectId, projectId)).orderBy(desc(caseStudies.updatedAt)).all();
}

/** Who the story is about, from the testimonial. */
function person(t: Pick<TestimonialWithTags, "authorName" | "authorTitle" | "authorCompany">) {
  return { name: t.authorName, title: t.authorTitle, company: t.authorCompany };
}

/** The pull quote a template starts with: a highlighted phrase, else the headline, else the text's first sentence. */
export function templateQuote(t: Pick<TestimonialWithTags, "id" | "headline" | "text" | "transcript">): string {
  const marked = listHighlights(t.id).find((h) => !h.answerId)?.phrase?.trim();
  if (marked) return marked.slice(0, 600);
  if (t.headline?.trim()) return t.headline.trim().slice(0, 600);
  const words = (t.text || t.transcript || "").trim().replace(/\s+/g, " ");
  const first = /^(.{20,280}?[.!?])(\s|$)/.exec(words)?.[1] ?? words.slice(0, 280);
  return first.trim();
}

/** SHARE-04 without AI: the template the owner fills in. */
export function templateFor(project: Pick<Project, "name">, t: TestimonialWithTags): { title: string; content: CaseStudyContent } {
  const who = t.authorCompany?.trim() || t.authorName;
  return {
    title: `${who} and ${project.name}`.slice(0, 160),
    content: caseStudyContentSchema.parse({ pullQuote: templateQuote(t) }),
  };
}

function testimonialOf(projectId: string, testimonialId: string): TestimonialWithTags {
  const t = getTestimonial(testimonialId);
  if (!t || t.projectId !== projectId) throw new CaseStudyError(404, "Testimonial not found");
  if (t.status === "trashed") throw new CaseStudyError(409, "That testimonial is in the trash");
  return t;
}

/** A new draft from a testimonial, filled from the template. */
export function createCaseStudy(project: Project, testimonialId: string): CaseStudy {
  const t = testimonialOf(project.id, testimonialId);
  const tpl = templateFor(project, t);
  const now = new Date();
  return getDb()
    .insert(caseStudies)
    .values({ id: crypto.randomUUID(), projectId: project.id, testimonialId: t.id, status: "draft", title: tpl.title, content: JSON.stringify(tpl.content), createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateCaseStudy(id: string, input: unknown): CaseStudy | null {
  const row = getCaseStudy(id);
  if (!row) return null;
  const parsed = caseStudyInputSchema.safeParse(input);
  if (!parsed.success) throw new CaseStudyError(400, parsed.error.issues[0]?.message ?? "Check the case study and try again");
  const v = parsed.data;
  return getDb()
    .update(caseStudies)
    .set({
      title: v.title,
      content: JSON.stringify(v.content),
      ...(v.status ? { status: v.status } : {}),
      ...(v.aiDrafted ? { aiDraftedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(caseStudies.id, id))
    .returning()
    .get();
}

export function deleteCaseStudy(id: string): boolean {
  return getDb().delete(caseStudies).where(eq(caseStudies.id, id)).run().changes > 0;
}

/** Whether the case study's testimonial may have public pages (so publishing means something). */
export function publicAllowed(t: Pick<TestimonialWithTags, "status" | "withdrawnAt" | "consentPublic"> | null): boolean {
  return Boolean(t && hasPublicPage(t));
}

export function caseStudyToAdmin(cs: CaseStudy) {
  const t = getTestimonial(cs.testimonialId);
  const canBePublic = publicAllowed(t);
  return {
    id: cs.id,
    projectId: cs.projectId,
    testimonialId: cs.testimonialId,
    status: cs.status,
    title: cs.title,
    content: parseContent(cs.content),
    aiDraftedAt: cs.aiDraftedAt?.toISOString() ?? null,
    person: t ? person(t) : null,
    /** Live only while published and the testimonial is public. */
    publicUrl: cs.status === "published" && canBePublic ? `${env.publicUrl}/cs/${cs.id}` : null,
    canBePublic,
    createdAt: cs.createdAt.toISOString(),
    updatedAt: cs.updatedAt.toISOString(),
  };
}
export type AdminCaseStudy = ReturnType<typeof caseStudyToAdmin>;

/** The testimonials a case study can be made from: everything not in the trash, newest first, with words to show. */
export function caseStudyCandidates(projectId: string, limit = 200) {
  return getDb()
    .select({ id: testimonials.id, name: testimonials.authorName, company: testimonials.authorCompany, status: testimonials.status, text: testimonials.text, headline: testimonials.headline })
    .from(testimonials)
    .where(and(eq(testimonials.projectId, projectId), ne(testimonials.status, "trashed")))
    .orderBy(desc(testimonials.createdAt))
    .limit(limit)
    .all()
    .map((r) => ({ id: r.id, name: r.name, company: r.company, status: r.status, words: (r.headline || r.text || "").slice(0, 120) }));
}

// ------------------------------------------------------------------ AI draft

/** Characters of a testimonial's words sent for a draft. */
const MAX_SOURCE_CHARS = 8000;

/** What the provider reads: the person, and their own words (text, transcript, answers). Never emails, phones or private fields. */
export function draftSource(project: Pick<Project, "name">, t: TestimonialWithTags): { prompt: string; words: string } {
  const parts = [
    t.headline ? `Headline: ${trimForAi(t.headline, 300)}` : "",
    t.text ? `Testimonial: ${trimForAi(t.text, 5000)}` : "",
    t.transcript ? `Video transcript: ${trimForAi(t.transcript, 5000)}` : "",
    ...listAnswers(t.id).flatMap((a) => {
      const said = trimForAi(a.text || a.transcript, 2000);
      return said ? [`Answer to "${trimForAi(a.questionTitle, 200)}": ${said}`] : [];
    }),
  ].filter(Boolean);
  const words = parts.join("\n\n").slice(0, MAX_SOURCE_CHARS);
  const who = [t.authorName, t.authorTitle, t.authorCompany].filter(Boolean).map((s) => trimForAi(s, 120)).join(", ");
  return { prompt: [`Product or business: ${trimForAi(project.name, 120)}`, `Customer: ${who}`, t.rating ? `Rating: ${t.rating} of 5` : "", "", words].filter((l) => l !== "").join("\n"), words };
}

const line = (max: number) => z.string().trim().max(max).catch("");
const aiDraftSchema = z.object({
  title: z.string().trim().min(1).max(160).catch(""),
  summary: line(500),
  challenge: line(3000),
  solution: line(3000),
  result: line(3000),
  pullQuote: line(600),
  metrics: z.array(metricSchema.nullable().catch(null)).max(10).catch([]),
});

const DRAFT_SYSTEM = [
  "You write short B2B customer case studies from one customer's testimonial. Answer with only a JSON object, no prose:",
  '{"title": string, "summary": string, "challenge": string, "solution": string, "result": string, "pullQuote": string, "metrics": [{"value": string, "label": string}]}',
  "Use only facts the customer states. Don't invent names, numbers, dates or features. Write in the third person, plainly, 2 to 4 sentences per section.",
  "pullQuote is one or two sentences copied word for word from the customer's words. metrics are at most 4 numbers the customer states (value like \"3x\" or \"40%\", label like \"faster onboarding\"); use an empty list when there are none.",
].join("\n");

/** The numbers in a string ("40%", "3x", "1,200") as plain digits. */
const numbers = (s: string) => [...s.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, ""));

/**
 * SHARE-04 "Draft with AI": suggested fields for the editor (not saved).
 * CaseStudyError 409 when AI is off for the project (the editor then shows
 * the template), 502 when the provider fails or answers nonsense.
 */
export async function draftCaseStudy(cs: CaseStudy): Promise<{ title: string; content: CaseStudyContent; dropped: string[] }> {
  const project = getProjectById(cs.projectId);
  if (!project) throw new CaseStudyError(404, "Project not found");
  if (!aiForProject(project)) throw new CaseStudyError(409, "AI isn't on for this project. Fill in the template, or see docs/help/insights.md to turn it on.");
  const t = testimonialOf(project.id, cs.testimonialId);
  const source = draftSource(project, t);
  if (!source.words.trim()) throw new CaseStudyError(409, "This testimonial has no words to draft from yet (a video waits for its transcript)");
  let a: z.infer<typeof aiDraftSchema>;
  try {
    a = await aiJson({ system: DRAFT_SYSTEM, user: source.prompt, schema: aiDraftSchema, maxTokens: 1500, timeoutMs: 45_000 });
  } catch (err) {
    if (err instanceof AiError) throw new CaseStudyError(502, err.message);
    throw err;
  }
  const tpl = templateFor(project, t);
  const dropped: string[] = [];
  const quote = a.pullQuote.replace(/^["“”'‘]+|["“”'’]+$/g, "").trim();
  let pullQuote = tpl.content.pullQuote;
  if (quote && quotedFrom(quote, source.words)) pullQuote = quote;
  else if (quote) dropped.push("the pull quote (not the customer's own words)");
  const sourceNumbers = new Set(numbers(source.words));
  const metrics = a.metrics.filter((m): m is z.infer<typeof metricSchema> => {
    if (!m) return false;
    const ns = numbers(m.value);
    const ok = ns.length > 0 && ns.every((n) => sourceNumbers.has(n));
    if (!ok) dropped.push(`the metric “${m.value} ${m.label}” (its number isn't in the testimonial)`);
    return ok;
  });
  return {
    title: a.title || tpl.title,
    content: caseStudyContentSchema.parse({
      summary: a.summary,
      challenge: a.challenge,
      solution: a.solution,
      result: a.result,
      pullQuote,
      metrics: metrics.slice(0, MAX_METRICS),
    }),
    dropped,
  };
}

// ------------------------------------------------------------------ public page and PDF

export type PublicCaseStudy = {
  id: string;
  title: string;
  content: CaseStudyContent;
  item: FeedItem;
  project: Pick<Project, "id" | "name" | "slug" | "accentColor" | "website" | "logoKey">;
  url: string;
};

/** What a case study shows the public, or null (404) unless published and its testimonial may be public. */
export function publicCaseStudy(id: string): PublicCaseStudy | null {
  if (!UUID.test(id)) return null;
  const cs = getCaseStudy(id);
  if (!cs || cs.status !== "published") return null;
  const t = getTestimonial(cs.testimonialId);
  if (!t || !publicAllowed(t)) return null;
  return caseStudyView(cs, t);
}

/** The same view for the team (a draft's preview and PDF), whatever its state. */
export function caseStudyView(cs: CaseStudy, t = getTestimonial(cs.testimonialId)): PublicCaseStudy | null {
  const project = getProjectById(cs.projectId);
  if (!project || !t) return null;
  return {
    id: cs.id,
    title: cs.title,
    content: parseContent(cs.content),
    item: toFeedItems([t])[0],
    project: { id: project.id, name: project.name, slug: project.slug, accentColor: project.accentColor, website: project.website, logoKey: project.logoKey },
    url: `${env.publicUrl}/cs/${cs.id}`,
  };
}
