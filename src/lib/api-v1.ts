import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ApiKey, ApiKeyScope, Campaign, Customer, Feedback, Project, Wall, Widget } from "@/db/schema";
import { apiKeyReaches, requireApiKey } from "./api-keys";
import { CampaignError, campaignToAdmin, type Funnel } from "./campaigns";
import { env } from "./env";
import { featureOn } from "./features";
import { FormError } from "./forms";
import { jsonError } from "./http";
import { ProjectError } from "./projects";
import { mediaUrl } from "./storage";
import { getProjectBySlug, getProjectById } from "./testimonials";
import { WallError, wallToAdmin } from "./walls";
import { WidgetError, widgetSnippets, widgetToAdmin } from "./widgets";

const { customers, feedback } = schema;

/**
 * Shared pieces of the M14 REST paths (API-01, API-02): forms, widgets,
 * walls, campaigns, tags, customers, feedback and analytics. Each route calls
 * the same src/lib function and zod schema as its dashboard twin, so a key
 * can do nothing the dashboard can't, and answers with the dashboard's shape
 * minus anything secret. They're behind the `api2` flag: with it off they
 * answer 404 and the API is what it was before M14.
 */

export const API_HEADERS = { "Cache-Control": "no-store" };

export const apiError = (status: number, message: string, extra?: Record<string, string>) =>
  jsonError(status, message, { ...API_HEADERS, ...extra });

/** Like requireApiKey, for an M14 path: a 404 while `api2` is off. */
export function requireApi2(req: Request, need: ApiKeyScope): { key: ApiKey; error?: undefined } | { error: Response; key?: undefined } {
  if (!featureOn("api2")) return { error: apiError(404, "Not found") };
  return requireApiKey(req, need) as { key: ApiKey } | { error: Response };
}

/**
 * Whether a key may reach a project (TEAM-01): a key made with a project
 * list reaches only those; older keys and keys made without one reach all.
 * Every /api/v1 route and the MCP server go through it.
 */
export function keyCanAccess(key: ApiKey, projectId: string): boolean {
  return apiKeyReaches(key, projectId);
}

/** The project by its slug, if the key may reach it. */
export function projectForKey(key: ApiKey, slug: string): Project | null {
  const p = getProjectBySlug(slug);
  return p && keyCanAccess(key, p.id) ? p : null;
}

/** The project a row belongs to, if the key may reach it: a row in a project it can't reach is "not found". */
export function projectOfRow(key: ApiKey, row: { projectId: string } | null | undefined): Project | null {
  if (!row) return null;
  const p = getProjectById(row.projectId);
  return p && keyCanAccess(key, p.id) ? p : null;
}

/**
 * The request body as JSON, read up to `max` bytes: it stops reading there,
 * even without a Content-Length. An error Response for too large or not JSON.
 */
export async function readJson(req: Request, max: number): Promise<{ value: unknown; error?: undefined } | { error: Response }> {
  const tooLarge = () => ({ error: apiError(413, `The body is too large (${Math.round(max / 1024)} KB at most)`) });
  if (Number(req.headers.get("content-length") ?? 0) > max) return tooLarge();
  if (!req.body) return { error: apiError(400, "Send a JSON body") };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return tooLarge();
    }
    chunks.push(value);
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { error: apiError(400, "The body isn't valid JSON") };
  }
}

/** Body caps: a form, widget or wall config is the largest thing sent; a recipient paste can be long. */
export const MAX_CONFIG_BYTES = 256 * 1024;
export const MAX_SMALL_BYTES = 16 * 1024;
export const MAX_RECIPIENTS_BYTES = 1024 * 1024;

/** A lib's refusal (FormError, WidgetError, WallError, CampaignError, ProjectError) as its status; anything else is rethrown. */
export function libError(err: unknown): Response {
  if (err instanceof FormError || err instanceof WidgetError || err instanceof WallError || err instanceof CampaignError || err instanceof ProjectError) {
    return apiError(err.status, err.message);
  }
  throw err;
}

/** `limit` (1–100, default 50) and `offset` from the query, or the 400 to send. */
export function pageParams(q: URLSearchParams): { limit: number; offset: number } | Response {
  const int = (raw: string | null, fallback: number) => (raw === null || raw === "" ? fallback : /^\d+$/.test(raw) ? Number(raw) : null);
  const limit = int(q.get("limit"), 50);
  if (limit === null || limit < 1 || limit > 100) return apiError(400, "limit must be a whole number from 1 to 100");
  const offset = int(q.get("offset"), 0);
  if (offset === null) return apiError(400, "offset must be a whole number, 0 or more");
  return { limit, offset };
}

export function pagination(total: number, limit: number, offset: number) {
  return { total, limit, offset, nextOffset: offset + limit < total ? offset + limit : null };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `from`/`to` must be YYYY-MM-DD when they're given (parseRange then clamps them); the 400 to send otherwise. */
export function rangeParams(q: URLSearchParams): { from: string | null; to: string | null } | Response {
  const from = q.get("from") || null;
  const to = q.get("to") || null;
  for (const [name, v] of [["from", from], ["to", to]] as const) {
    if (v !== null && (!DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) return apiError(400, `${name} must be a date such as 2026-10-01`);
  }
  return { from, to };
}

// ------------------------------------------------------------------ shapes

const abs = (path: string | null) => (path ? `${env.publicUrl}${path}` : null);

/** A widget as the studio sees it, with its embed snippets. */
export function widgetToApi(w: Widget) {
  return { ...widgetToAdmin(w), embed: widgetSnippets(env.publicUrl, w.id) };
}

/** A wall as the editor sees it, with absolute addresses. */
export function wallToApi(w: Wall, project: Pick<Project, "slug">) {
  const a = wallToAdmin(w, project);
  return { ...a, url: abs(a.url)!, publicUrl: abs(a.publicUrl)!, logoUrl: abs(a.logoUrl), coverUrl: abs(a.coverUrl), faviconUrl: abs(a.faviconUrl) };
}

/** A campaign as the dashboard sees it, minus the incoming webhook's prefix: the API only says whether it's on. */
export function campaignToApi(c: Campaign, funnel?: Funnel) {
  const { webhook, ...rest } = campaignToAdmin(c, funnel);
  return { ...rest, webhook: { on: webhook.on } };
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function customerToApi(c: Customer) {
  return {
    id: c.id,
    projectId: c.projectId,
    email: c.email,
    name: c.name,
    title: c.title,
    company: c.company,
    website: c.website,
    avatarUrl: abs(mediaUrl(c.avatarKey)),
    socials: parseObject(c.socials),
    custom: parseObject(c.custom),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function feedbackToApi(f: Feedback) {
  return {
    id: f.id,
    projectId: f.projectId,
    formId: f.formId,
    customerId: f.customerId,
    testimonialId: f.testimonialId,
    source: f.source,
    rating: f.rating,
    text: f.text,
    author: { name: f.authorName, email: f.authorEmail },
    createdAt: f.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------------ reads the dashboard has no lib call for

/** A project's customers, by name, optionally only the one with `email`. */
export function listCustomers(projectId: string, o: { limit: number; offset: number; email?: string | null }) {
  const db = getDb();
  const where = and(eq(customers.projectId, projectId), o.email ? eq(customers.email, o.email.trim().toLowerCase()) : undefined);
  const total = db.select({ n: sql<number>`count(*)` }).from(customers).where(where).get()?.n ?? 0;
  const rows = db.select().from(customers).where(where).orderBy(asc(sql`${customers.name} COLLATE NOCASE`), asc(customers.id)).limit(o.limit).offset(o.offset).all();
  return { rows, total };
}

export function getCustomer(id: string): Customer | null {
  return getDb().select().from(customers).where(eq(customers.id, id)).get() ?? null;
}

/** A project's private feedback, newest first, as the Feedback tab lists it (trashed feedback left out). */
export function listFeedbackPage(projectId: string, o: { limit: number; offset: number }) {
  const db = getDb();
  const where = and(eq(feedback.projectId, projectId), isNull(feedback.trashedAt));
  const total = db.select({ n: sql<number>`count(*)` }).from(feedback).where(where).get()?.n ?? 0;
  const rows = db.select().from(feedback).where(where).orderBy(desc(feedback.createdAt), asc(feedback.id)).limit(o.limit).offset(o.offset).all();
  return { rows, total };
}
