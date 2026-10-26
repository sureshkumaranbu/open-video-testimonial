import { z } from "zod";
import type { ConsentScope } from "./consent";

/**
 * The inbox view (INBOX-01..05) as data: tabs, filters, sort and page, and
 * how they read from and write to the address bar, so a view can be shared
 * by copying the URL. Client-safe (no database), so the dashboard and the
 * server parse a view the same way; lib/inbox.ts runs the query.
 */

/** What a person agreed to; kept equal to consent.ts CONSENT_SCOPES (which needs the server). */
const SCOPES = ["website", "social", "ads", "name", "face"] as const satisfies readonly ConsentScope[];
/** Same rule as validation.ts tagNameSchema; tags are stored in lower case. */
const tagNameSchema = z.string().trim().min(1).max(32);

export const INBOX_TABS = ["all", "pending", "approved", "hidden", "rejected", "feedback", "trash"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];
export const INBOX_SORTS = ["created", "posted", "rating", "name", "words"] as const;
export type InboxSort = (typeof INBOX_SORTS)[number];
export const INBOX_TYPES = ["text", "video", "image"] as const;
export type InboxType = (typeof INBOX_TYPES)[number];
/** How a testimonial arrived (`testimonials.source`, D4), as the filter names it. */
export const INBOX_METHODS = ["form", "manual", "csv", "platform", "api"] as const;
export type InboxMethod = (typeof INBOX_METHODS)[number];
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
/** The most rows one bulk action changes. */
export const MAX_BULK = 500;

const day = z.iso.date();
const list = <T extends z.ZodType>(item: T) => z.array(item).catch([]);

/** The whole view. Bad values in a hand-edited URL fall back to their default instead of failing. */
export const inboxQuerySchema = z.object({
  tab: z.enum(INBOX_TABS).catch("pending"),
  q: z.string().max(200).catch(""),
  /** 0 means "no rating". */
  rating: list(z.coerce.number().int().min(0).max(5)),
  tags: list(tagNameSchema.transform((t) => t.toLowerCase())),
  tagMode: z.enum(["any", "all"]).catch("any"),
  formId: z.string().max(64).nullable().catch(null),
  type: z.enum(INBOX_TYPES).nullable().catch(null),
  platform: list(z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9][a-z0-9._-]*$/)),
  method: list(z.enum(INBOX_METHODS)),
  language: z.string().trim().max(35).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/).nullable().catch(null),
  hasAvatar: z.boolean().catch(false),
  hasLogo: z.boolean().catch(false),
  hasImages: z.boolean().catch(false),
  scope: z.enum(SCOPES).nullable().catch(null),
  /** Word count range; either end may be open. */
  wordsMin: z.coerce.number().int().min(0).max(100_000).nullable().catch(null),
  wordsMax: z.coerce.number().int().min(0).max(100_000).nullable().catch(null),
  /** Date added, as YYYY-MM-DD days in UTC; both ends included. */
  from: day.nullable().catch(null),
  to: day.nullable().catch(null),
  sort: z.enum(INBOX_SORTS).catch("created"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  pageSize: z.coerce
    .number()
    .refine((n): n is PageSize => (PAGE_SIZES as readonly number[]).includes(n))
    .catch(25),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema> & { pageSize: PageSize };

export const DEFAULT_QUERY: InboxQuery = inboxQuerySchema.parse({}) as InboxQuery;

/** The per-person view defaults (INBOX-04: the sort is remembered). */
export type InboxPrefs = { inboxView: "card" | "table"; inboxSort: InboxSort; inboxDir: "asc" | "desc"; pageSize: PageSize };
export const DEFAULT_PREFS: InboxPrefs = { inboxView: "card", inboxSort: "created", inboxDir: "desc", pageSize: 25 };

export const inboxPrefsSchema = z
  .object({
    inboxView: z.enum(["card", "table"]),
    inboxSort: z.enum(INBOX_SORTS),
    inboxDir: z.enum(["asc", "desc"]),
    pageSize: z.number().refine((n): n is PageSize => (PAGE_SIZES as readonly number[]).includes(n), "Choose 25, 50 or 100 per page"),
  })
  .partial();

/** Comma lists and repeated keys both work: ?rating=4,5 and ?rating=4&rating=5. */
function many(sp: URLSearchParams, key: string, split = true) {
  return sp.getAll(key).flatMap((v) => (split ? v.split(",") : [v])).map((v) => v.trim()).filter(Boolean);
}

const flag = (v: string | null) => v === "1" || v === "true";

/** Reads a view from the address bar. `defaults` are the person's remembered sort and page size. */
export function parseInboxParams(sp: URLSearchParams, defaults: Partial<Pick<InboxQuery, "sort" | "dir" | "pageSize">> = {}): InboxQuery {
  const [min, max] = (sp.get("words") ?? "").split("-");
  const raw: Record<string, unknown> = {
    tab: sp.get("tab") ?? undefined,
    q: sp.get("q") ?? undefined,
    rating: many(sp, "rating"),
    // A tag name may hold a comma, so tags are only ever repeated.
    tags: many(sp, "tag", false),
    tagMode: sp.get("tagMode") ?? undefined,
    formId: sp.get("form") || null,
    type: sp.get("type") || null,
    platform: many(sp, "platform"),
    method: many(sp, "method"),
    language: sp.get("lang") || null,
    hasAvatar: flag(sp.get("avatar")),
    hasLogo: flag(sp.get("logo")),
    hasImages: flag(sp.get("images")),
    scope: sp.get("scope") || null,
    wordsMin: min ? min : null,
    wordsMax: max ? max : null,
    from: sp.get("from") || null,
    to: sp.get("to") || null,
    sort: sp.get("sort") ?? defaults.sort,
    dir: sp.get("dir") ?? defaults.dir,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("size") ?? defaults.pageSize,
  };
  const q = inboxQuerySchema.parse(raw) as InboxQuery;
  // Lists keep each value once, so a URL can't ask for the same tag fifty times.
  return { ...q, rating: [...new Set(q.rating)], tags: [...new Set(q.tags)].slice(0, 20), platform: [...new Set(q.platform)].slice(0, 20), method: [...new Set(q.method)] };
}

/** The address-bar form of a view, leaving out everything at its default (and the person's own defaults). */
export function toInboxParams(q: Partial<InboxQuery>, defaults: Partial<Pick<InboxQuery, "sort" | "dir" | "pageSize">> = {}): URLSearchParams {
  const d = { ...DEFAULT_QUERY, ...defaults };
  const sp = new URLSearchParams();
  if (q.tab && q.tab !== d.tab) sp.set("tab", q.tab);
  if (q.q?.trim()) sp.set("q", q.q.trim());
  if (q.rating?.length) sp.set("rating", [...q.rating].sort().join(","));
  for (const t of q.tags ?? []) sp.append("tag", t);
  if (q.tags && q.tags.length > 1 && q.tagMode === "all") sp.set("tagMode", "all");
  if (q.formId) sp.set("form", q.formId);
  if (q.type) sp.set("type", q.type);
  if (q.platform?.length) sp.set("platform", q.platform.join(","));
  if (q.method?.length) sp.set("method", q.method.join(","));
  if (q.language) sp.set("lang", q.language);
  if (q.hasAvatar) sp.set("avatar", "1");
  if (q.hasLogo) sp.set("logo", "1");
  if (q.hasImages) sp.set("images", "1");
  if (q.scope) sp.set("scope", q.scope);
  if (q.wordsMin != null || q.wordsMax != null) sp.set("words", `${q.wordsMin ?? ""}-${q.wordsMax ?? ""}`);
  if (q.from) sp.set("from", q.from);
  if (q.to) sp.set("to", q.to);
  if (q.sort && q.sort !== d.sort) sp.set("sort", q.sort);
  if (q.dir && q.dir !== d.dir) sp.set("dir", q.dir);
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  if (q.pageSize && q.pageSize !== d.pageSize) sp.set("size", String(q.pageSize));
  return sp;
}
