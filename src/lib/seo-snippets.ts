import { randomInt } from "node:crypto";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Project, SeoSnippet } from "@/db/schema";
import { feedAggregate, listFeed, ratingSummary } from "./public-feed";
import { jsonLdScript, reviewJsonLd, SCOPE_MODES, SEO_MAX_REVIEWS, SEO_SCHEMA_TYPES, seoGuidance, snippetJs, type SeoSchemaType } from "./seo";
import { firstIssue } from "./validation";
import type { PublicFilters } from "./widget-config";

const { seoSnippets, forms } = schema;

/**
 * Saved review snippets (SEO-01): which testimonials (all, some tags, or one
 * form) describe which thing, as schema.org data the owner pastes into their
 * own page, either as it is now ("static") or as a script that always sends
 * the latest reviews ("dynamic", /schema/s_….js).
 */

export class SnippetError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
export const SNIPPET_ID = /^s_[a-z0-9]{12}$/;

/** "s_" + 12 base36 characters. */
export function newSnippetId(): string {
  let s = "s_";
  for (let i = 0; i < 12; i++) s += ID_CHARS[randomInt(36)];
  return s;
}

/** Which testimonials count. Stored in the scope column; a subset of the widgets' PublicFilters. */
export const snippetScopeSchema = z.object({
  mode: z.enum(SCOPE_MODES).default("all"),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(20).default([]),
  formId: z.string().max(64).default(""),
});
export type SnippetScope = z.output<typeof snippetScopeSchema>;

const urlOrEmpty = z.union([z.literal(""), z.string().trim().max(500).regex(/^https?:\/\/[^\s<>"]+$/i, "Use a full web address starting with https://")]);

/** The thing being reviewed. */
export const snippetItemSchema = z.object({
  name: z.string().trim().max(120).default(""),
  url: urlOrEmpty.default(""),
  description: z.string().trim().max(300).default(""),
});
export type SnippetItem = z.output<typeof snippetItemSchema>;

function json(raw: string | null | undefined): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export function snippetScope(s: Pick<SeoSnippet, "scope">): SnippetScope {
  const r = snippetScopeSchema.safeParse(json(s.scope));
  return r.success ? r.data : snippetScopeSchema.parse({});
}

export function snippetItem(s: Pick<SeoSnippet, "item">): SnippetItem {
  const r = snippetItemSchema.safeParse(json(s.item));
  return r.success ? r.data : snippetItemSchema.parse({});
}

/** The scope as feed filters. An empty tag list or a missing form falls back to every public testimonial. */
export function scopeFilters(scope: SnippetScope): PublicFilters {
  if (scope.mode === "tags" && scope.tags.length) return { tags: scope.tags };
  if (scope.mode === "form" && scope.formId) return { formId: scope.formId };
  return {};
}

function checkScope(projectId: string, scope: SnippetScope): SnippetScope {
  if (scope.mode === "tags" && !scope.tags.length) throw new SnippetError(400, "Pick at least one tag, or choose all testimonials");
  if (scope.mode === "form") {
    const form = scope.formId ? getDb().select().from(forms).where(eq(forms.id, scope.formId)).get() : undefined;
    if (!form || form.projectId !== projectId) throw new SnippetError(400, "Choose one of this project's forms");
  }
  return {
    mode: scope.mode,
    tags: scope.mode === "tags" ? [...new Set(scope.tags)] : [],
    formId: scope.mode === "form" ? scope.formId : "",
  };
}

// ------------------------------------------------------------------ CRUD

export function listSnippets(projectId: string): SeoSnippet[] {
  return getDb().select().from(seoSnippets).where(eq(seoSnippets.projectId, projectId)).orderBy(asc(seoSnippets.createdAt), asc(seoSnippets.id)).all();
}

export function getSnippet(id: string): SeoSnippet | null {
  return getDb().select().from(seoSnippets).where(eq(seoSnippets.id, id)).get() ?? null;
}

export type SnippetInput = { name: string; schemaType?: SeoSchemaType; scope?: z.input<typeof snippetScopeSchema>; item?: z.input<typeof snippetItemSchema> };

function parse<S extends z.ZodType>(s: S, v: unknown): z.output<S> {
  const r = s.safeParse(v ?? {});
  if (!r.success) throw new SnippetError(400, firstIssue(r.error));
  return r.data;
}

export function createSnippet(project: Pick<Project, "id" | "name">, i: SnippetInput): SeoSnippet {
  const scope = checkScope(project.id, parse(snippetScopeSchema, i.scope));
  const item = parse(snippetItemSchema, i.item);
  const now = new Date();
  const db = getDb();
  for (let attempt = 0; ; attempt++) {
    const id = newSnippetId();
    try {
      db.insert(seoSnippets)
        .values({
          id,
          projectId: project.id,
          name: i.name.trim().slice(0, 120) || "Review snippet",
          schemaType: i.schemaType ?? "Product",
          scope: JSON.stringify(scope),
          item: JSON.stringify({ ...item, name: item.name || project.name }),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return getSnippet(id)!;
    } catch (err) {
      if (attempt < 3 && String(err).includes("UNIQUE")) continue;
      throw err;
    }
  }
}

export type SnippetPatch = Partial<SnippetInput>;

export function updateSnippet(id: string, p: SnippetPatch): SeoSnippet | null {
  const s = getSnippet(id);
  if (!s) return null;
  const set: Partial<typeof seoSnippets.$inferInsert> = { updatedAt: new Date() };
  if (p.name !== undefined) set.name = p.name.trim().slice(0, 120) || s.name;
  if (p.schemaType !== undefined) set.schemaType = p.schemaType;
  if (p.scope !== undefined) set.scope = JSON.stringify(checkScope(s.projectId, parse(snippetScopeSchema, p.scope)));
  if (p.item !== undefined) set.item = JSON.stringify(parse(snippetItemSchema, p.item));
  getDb().update(seoSnippets).set(set).where(eq(seoSnippets.id, id)).run();
  return getSnippet(id);
}

export function deleteSnippet(id: string): boolean {
  return getDb().delete(seoSnippets).where(eq(seoSnippets.id, id)).run().changes > 0;
}

// ------------------------------------------------------------------ output

/** The snippet's current JSON-LD and the counts its guidance is based on. */
export function snippetData(s: SeoSnippet, project: Pick<Project, "id" | "name">) {
  const filters = scopeFilters(snippetScope(s));
  // Ask for more than ten: reviews without text are skipped.
  const items = listFeed(project.id, filters, { limit: SEO_MAX_REVIEWS * 3 });
  const rated = ratingSummary(project.id, filters);
  const all = feedAggregate(project.id, filters);
  const item = snippetItem(s);
  const jsonLd = reviewJsonLd({
    type: s.schemaType,
    name: item.name || project.name,
    url: item.url,
    description: item.description,
    items,
    aggregate: rated,
  });
  return { jsonLd, reviews: all.count, rated };
}

/** SEO-01: the two ways to put the data on a page. */
export function snippetCodes(origin: string, id: string, jsonLd: object) {
  const o = origin.replace(/\/+$/, "");
  return {
    static: jsonLdScript(jsonLd, { indent: 2 }),
    dynamic: `<script src="${o}/schema/${id}.js" async></script>`,
  };
}

/** The script /schema/s_….js serves. */
export function snippetScript(s: SeoSnippet, project: Pick<Project, "id" | "name">): string {
  return snippetJs(s.id, snippetData(s, project).jsonLd);
}

/** The snippet as the SEO page sees it (owner-only). */
export function snippetToAdmin(s: SeoSnippet, project: Pick<Project, "id" | "name">, origin: string) {
  const data = snippetData(s, project);
  return {
    id: s.id,
    name: s.name,
    schemaType: s.schemaType,
    scope: snippetScope(s),
    item: snippetItem(s),
    stats: { reviews: data.reviews, rated: data.rated.count, average: data.rated.average },
    guidance: seoGuidance({ reviews: data.reviews, rated: data.rated.count, type: s.schemaType }),
    jsonLd: data.jsonLd,
    codes: snippetCodes(origin, s.id, data.jsonLd),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
export type AdminSnippet = ReturnType<typeof snippetToAdmin>;

// ------------------------------------------------------------ admin API bodies

export const createSnippetBody = z.object({
  name: z.string().trim().min(1, "Give the snippet a name").max(120),
  schemaType: z.enum(SEO_SCHEMA_TYPES).default("Product"),
  scope: z.record(z.string(), z.unknown()).optional(),
  item: z.record(z.string(), z.unknown()).optional(),
});

export const snippetPatchBody = z
  .object({
    name: z.string().trim().min(1, "Give the snippet a name").max(120),
    schemaType: z.enum(SEO_SCHEMA_TYPES),
    scope: z.record(z.string(), z.unknown()),
    item: z.record(z.string(), z.unknown()),
  })
  .partial();
