import { and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Testimonial } from "@/db/schema";
import { withTags } from "./inbox";
import { mediaUrl } from "./storage";
import { toPublic, type TestimonialWithTags } from "./testimonials";
import { publicFiltersSchema, type FeedAggregate, type FeedItem, type PublicFilters, type ResolvedFilters } from "./widget-config";

const { testimonials, testimonialImages, highlights } = schema;

/**
 * The widget-mode public feed (DISP-01, DISP-02, DISP-07). Unlike the
 * data-project feed (listPublicTestimonials, untouched: D18), every rule runs
 * in SQL before the LIMIT, so "minimum 4 stars, 10 items" really returns ten.
 * Public rows only: approved and not withdrawn, the same rule as toPublic's
 * callers. Output goes through toFeedItem, a whitelist on top of toPublic.
 */

export type FeedOptions = {
  /** manual: only `manualIds`, in that order. */
  mode?: "auto" | "manual";
  manualIds?: string[];
  /** Shown first, in this order (if they match). */
  pinnedIds?: string[];
  limit: number;
  /** Sends "Ada" for "Ada Lovelace", so the surname never leaves the server. */
  firstNameOnly?: boolean;
  /** Auto mode without pins: skip this many (a wall's "load more" pages). */
  offset?: number;
};

const hasImage = sql`EXISTS (SELECT 1 FROM testimonial_images i WHERE i.testimonial_id = ${testimonials.id})`;
const shownDate = sql`coalesce(${testimonials.sourceDate}, ${testimonials.createdAt})`;

/** A LIKE pattern that matches `s` literally (with ESCAPE '\'). */
function likeAnywhere(s: string) {
  return `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const words = sql`lower(coalesce(${testimonials.text}, '') || ' ' || coalesce(${testimonials.headline}, ''))`;

/** The public rule: what any public surface may show. */
function publicConditions(projectId: string): SQL[] {
  return [eq(testimonials.projectId, projectId), eq(testimonials.status, "approved"), isNull(testimonials.withdrawnAt)];
}

function filterConditions(projectId: string, f: ResolvedFilters): SQL[] {
  const c = publicConditions(projectId);
  if (f.minRating > 0) c.push(sql`${testimonials.rating} >= ${f.minRating}`);
  if (f.tags.length) {
    const tagged = sql`SELECT tt.testimonial_id FROM testimonial_tags tt JOIN tags g ON g.id = tt.tag_id
      WHERE g.project_id = ${projectId} AND g.name IN (${sql.join(f.tags.map((t) => sql`${t}`), sql`, `)})`;
    const distinct = new Set(f.tags).size;
    c.push(
      f.tagMode === "all" && distinct > 1
        ? sql`${testimonials.id} IN (${tagged} GROUP BY tt.testimonial_id HAVING count(DISTINCT g.name) = ${distinct})`
        : sql`${testimonials.id} IN (${tagged})`,
    );
  }
  if (f.platforms.length) c.push(inArray(testimonials.platform, f.platforms));
  // Answer videos are owner-only (D13), so "video" means the primary video.
  if (f.type === "video") c.push(sql`${testimonials.videoKey} IS NOT NULL`);
  if (f.type === "image") c.push(hasImage);
  if (f.type === "text") c.push(sql`(${testimonials.videoKey} IS NULL AND ${testimonials.text} IS NOT NULL AND trim(${testimonials.text}) <> '')`);
  if (f.include.length) c.push(sql`(${sql.join(f.include.map((k) => sql`${words} LIKE ${likeAnywhere(k)} ESCAPE '\\'`), sql` OR `)})`);
  for (const k of f.exclude) c.push(sql`${words} NOT LIKE ${likeAnywhere(k)} ESCAPE '\\'`);
  if (f.language) c.push(sql`lower(${testimonials.language}) = ${f.language.toLowerCase()}`);
  if (f.formId) c.push(eq(testimonials.formId, f.formId));
  return c;
}

function orderBy(f: ResolvedFilters): SQL[] {
  switch (f.sort) {
    case "oldest":
      return [asc(shownDate), asc(testimonials.id)];
    case "rating":
      return [sql`${testimonials.rating} IS NULL`, desc(testimonials.rating), desc(shownDate), asc(testimonials.id)];
    // The inbox's own pins first, then newest.
    case "manual":
      return [sql`${testimonials.pinOrder} IS NULL`, asc(testimonials.pinOrder), desc(shownDate), asc(testimonials.id)];
    // "random" is shuffled by widget.js on each page view; the server's answer stays cacheable and the same.
    default:
      return [desc(shownDate), asc(testimonials.id)];
  }
}

const unique = (ids: string[] | undefined) => [...new Set(ids ?? [])];

function byIds(rows: Testimonial[], ids: string[]) {
  const map = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => map.get(id)).filter((r): r is Testimonial => Boolean(r));
}

/** The testimonials a widget shows, in order: pins, then the rest (or the manual list), at most `limit`. */
export function listFeed(projectId: string, filters: PublicFilters, o: FeedOptions): FeedItem[] {
  const f = publicFiltersSchema.parse(filters ?? {});
  const limit = Math.max(0, Math.min(o.limit, f.max));
  if (!limit) return [];
  const db = getDb();
  const where = filterConditions(projectId, f);
  const pinned = unique(o.pinnedIds);
  let rows: Testimonial[];

  if (o.mode === "manual") {
    const ids = unique(o.manualIds);
    if (!ids.length) return [];
    const found = db.select().from(testimonials).where(and(...where, inArray(testimonials.id, ids))).all();
    // Pins first (only ones that are also picked), then the picked order.
    const order = [...pinned.filter((id) => ids.includes(id)), ...ids.filter((id) => !pinned.includes(id))];
    rows = byIds(found, order).slice(0, limit);
  } else {
    const pins = pinned.length
      ? byIds(db.select().from(testimonials).where(and(...where, inArray(testimonials.id, pinned))).all(), pinned).slice(0, limit)
      : [];
    const rest = limit - pins.length;
    const others = rest
      ? db
          .select()
          .from(testimonials)
          .where(and(...where, ...(pins.length ? [notInArray(testimonials.id, pins.map((p) => p.id))] : [])))
          .orderBy(...orderBy(f))
          .limit(rest)
          .offset(pins.length ? 0 : Math.max(0, Math.floor(o.offset ?? 0)))
          .all()
      : [];
    rows = [...pins, ...others];
  }
  return toFeedItems(withTags(rows), { firstNameOnly: o.firstNameOnly });
}

/** Count and average rating, before any LIMIT. `all` ignores the filters (but never the public rule). */
export function feedAggregate(
  projectId: string,
  filters: PublicFilters,
  o: { scope?: "all" | "filtered"; mode?: "auto" | "manual"; manualIds?: string[] } = {},
): FeedAggregate {
  const f = publicFiltersSchema.parse(filters ?? {});
  const where = o.scope === "all" ? publicConditions(projectId) : filterConditions(projectId, f);
  if (o.scope !== "all" && o.mode === "manual") {
    const ids = unique(o.manualIds);
    if (!ids.length) return { count: 0, average: null };
    where.push(inArray(testimonials.id, ids));
  }
  const row = getDb()
    .select({ n: sql<number>`count(*)`, avg: sql<number | null>`avg(${testimonials.rating})` })
    .from(testimonials)
    .where(and(...where))
    .get();
  const avg = row?.avg;
  return { count: row?.n ?? 0, average: avg == null ? null : Math.round(avg * 10) / 10 };
}

/**
 * Rated public testimonials that match `filters` (before any LIMIT): their
 * count and average. schema.org's AggregateRating counts ratings, so the
 * unrated ones that feedAggregate counts are left out (SEO-01, WALL-03).
 */
export function ratingSummary(projectId: string, filters: PublicFilters): FeedAggregate {
  const f = publicFiltersSchema.parse(filters ?? {});
  const row = getDb()
    .select({ n: sql<number>`count(${testimonials.rating})`, avg: sql<number | null>`avg(${testimonials.rating})` })
    .from(testimonials)
    .where(and(...filterConditions(projectId, f), sql`${testimonials.rating} BETWEEN 1 AND 5`))
    .get();
  const avg = row?.avg;
  return { count: row?.n ?? 0, average: avg == null ? null : Math.round(avg * 10) / 10 };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const httpOnly = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

/** The widget's public shape of one testimonial: toPublic (frozen) plus display extras, never a private field. */
export function toFeedItem(
  t: TestimonialWithTags,
  extra: { images?: { key: string; alt: string | null }[]; highlights?: { start: number; end: number }[]; firstNameOnly?: boolean } = {},
): FeedItem {
  const base = toPublic(t);
  return {
    ...base,
    name: extra.firstNameOnly ? firstName(base.name) : base.name,
    extra: {
      headline: t.headline,
      date: (t.sourceDate ?? t.createdAt).toISOString(),
      datePrecision: t.datePrecision,
      platform: t.platform,
      sourceUrl: httpOnly(t.sourceUrl),
      verified: t.source === "form",
      images: (extra.images ?? []).map((i) => ({ url: mediaUrl(i.key)!, alt: i.alt })),
      companyLogoUrl: mediaUrl(t.companyLogoKey),
      highlights: (extra.highlights ?? []).map((h) => ({ start: h.start, end: h.end })),
    },
  };
}

/** toFeedItem for many rows, with their images and highlights in two queries. */
export function toFeedItems(rows: TestimonialWithTags[], o: { firstNameOnly?: boolean } = {}): FeedItem[] {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const imgs = new Map<string, { key: string; alt: string | null }[]>();
  for (const i of db
    .select({ id: testimonialImages.testimonialId, key: testimonialImages.key, alt: testimonialImages.alt })
    .from(testimonialImages)
    .where(inArray(testimonialImages.testimonialId, ids))
    .orderBy(asc(testimonialImages.position), asc(testimonialImages.createdAt))
    .all())
    imgs.set(i.id, [...(imgs.get(i.id) ?? []), { key: i.key, alt: i.alt }]);
  const marks = new Map<string, { start: number; end: number }[]>();
  for (const h of db
    .select({ id: highlights.testimonialId, start: highlights.start, end: highlights.end })
    .from(highlights)
    .where(and(inArray(highlights.testimonialId, ids), isNull(highlights.answerId)))
    .orderBy(asc(highlights.start))
    .all())
    marks.set(h.id, [...(marks.get(h.id) ?? []), { start: h.start, end: h.end }]);
  return rows.map((t) =>
    toFeedItem(t, {
      images: (imgs.get(t.id) ?? []).slice(0, 6),
      highlights: (marks.get(t.id) ?? []).filter((h) => t.text && h.start >= 0 && h.end <= t.text.length && h.start < h.end),
      firstNameOnly: o.firstNameOnly,
    }),
  );
}
