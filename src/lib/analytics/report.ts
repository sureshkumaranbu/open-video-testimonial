import { and, asc, between, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { AnalyticsMetric, AnalyticsObject, Widget } from "@/db/schema";
import { funnelOf } from "../campaigns";
import { pageEnabled } from "../forms/engine";
import { type FormPage, type PageType, parseFormRow } from "../forms/schema";
import { aggregateRaw, installStatus, OTHER_DIM, type InstallStatus, type TotalRow } from "./rollup";
import { RETENTION_DAYS, utcDay } from "./collect";

const { analyticsDaily, analyticsRollups, testimonials, feedback, requests, campaigns, boosters, boosterClicks, widgets, forms, walls, seoSnippets } = schema;

/**
 * What the dashboard shows (AN-01, DISP-14, FORM-15, WALL-05, SEO-04): daily
 * totals for days that are rolled up, plus the raw events of days that
 * aren't yet (today), through the same aggregation. Visitors are counted per
 * day, so someone who comes back on another day counts again.
 */

const DAY_MS = 86_400_000;
/** The longest range one report covers (there's no limit on how far back). */
export const MAX_RANGE_DAYS = 731;
export const WIDGET_CLICKS = ["more", "source", "cta", "play"] as const satisfies AnalyticsMetric[];

export type DateRange = { from: string; to: string };
export type Period = DateRange & { days: string[] };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => utcDay(new Date(dayMs(d) + n * DAY_MS));

/** Every day from `from` to `to`, both included. */
export function daysOf(r: DateRange): string[] {
  const out: string[] = [];
  for (let d = r.from; d <= r.to && out.length <= MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A valid range from the query (`from`, `to`), else the last 30 days. The end never passes today. */
export function parseRange(from: string | null | undefined, to: string | null | undefined, now = new Date()): Period {
  const today = utcDay(now);
  const valid = (d: string | null | undefined): d is string => Boolean(d && DAY_RE.test(d) && !Number.isNaN(dayMs(d)) && utcDay(new Date(dayMs(d))) === d);
  let end = valid(to) && to! <= today ? to! : today;
  let start = valid(from) ? from! : addDays(end, -29);
  if (start > end) [start, end] = [end, start];
  if ((dayMs(end) - dayMs(start)) / DAY_MS + 1 > MAX_RANGE_DAYS) start = addDays(end, -(MAX_RANGE_DAYS - 1));
  const r = { from: start, to: end };
  return { ...r, days: daysOf(r) };
}

/** The same number of days just before. */
export function previousPeriod(p: Period): Period {
  const n = p.days.length;
  const r = { from: addDays(p.from, -n), to: addDays(p.from, -1) };
  return { ...r, days: daysOf(r) };
}

type Scope = { projectIds: string[]; object?: { type: AnalyticsObject; id: string }; type?: AnalyticsObject; dims?: boolean };

/** Totals for a period: rolled days from analytics_daily, the rest from raw events (when they're still kept). */
export function readTotals(p: Period, s: Scope, now = new Date()): TotalRow[] {
  if (!s.projectIds.length || !p.days.length) return [];
  const db = getDb();
  const rolled = new Set(
    db.select({ day: analyticsRollups.day }).from(analyticsRollups).where(between(analyticsRollups.day, p.from, p.to)).all().map((r) => r.day),
  );
  const oldest = utcDay(new Date(now.getTime() - (RETENTION_DAYS + 1) * DAY_MS));
  const live = p.days.filter((d) => !rolled.has(d) && d >= oldest);
  const where = [
    between(analyticsDaily.day, p.from, p.to),
    inArray(analyticsDaily.projectId, s.projectIds),
    s.object ? and(eq(analyticsDaily.objectType, s.object.type), eq(analyticsDaily.objectId, s.object.id)) : undefined,
    s.type ? eq(analyticsDaily.objectType, s.type) : undefined,
    s.dims ? undefined : eq(analyticsDaily.dim, ""),
  ];
  const stored = db.select().from(analyticsDaily).where(and(...where)).all() as TotalRow[];
  // Dropped counts are written as they happen, so they're read for every day; the rest only for rolled days.
  const out = stored.filter((r) => r.metric === "dropped" || rolled.has(r.day));
  const raw = aggregateRaw(live, { projectIds: s.projectIds, object: s.object, dims: s.dims, totals: !s.object });
  out.push(...(s.type ? raw.filter((r) => r.objectType === s.type) : raw));
  return out;
}

export type MetricTotals = Partial<Record<AnalyticsMetric, { count: number; uniques: number }>>;

/** Sums rows per metric (uniques are summed per day: daily visitors). */
export function sumMetrics(rows: TotalRow[], pick: (r: TotalRow) => boolean = () => true): MetricTotals {
  const out: MetricTotals = {};
  for (const r of rows) {
    if (!pick(r)) continue;
    const m = (out[r.metric] ??= { count: 0, uniques: 0 });
    m.count += r.count;
    m.uniques += r.uniques;
  }
  return out;
}

const n = (t: MetricTotals, m: AnalyticsMetric) => t[m]?.count ?? 0;
const u = (t: MetricTotals, m: AnalyticsMetric) => t[m]?.uniques ?? 0;

function dailySeries(rows: TotalRow[], days: string[], metric: AnalyticsMetric | AnalyticsMetric[], field: "count" | "uniques" = "count") {
  const metrics = Array.isArray(metric) ? metric : [metric];
  const at = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const r of rows) if (metrics.includes(r.metric) && at.has(r.day)) out[at.get(r.day)!] += r[field];
  return out;
}

function topDims(rows: TotalRow[], metric: AnalyticsMetric, limit = 10) {
  const by = new Map<string, { dim: string; count: number; uniques: number }>();
  for (const r of rows) {
    if (r.metric !== metric || !r.dim) continue;
    const d = by.get(r.dim) ?? { dim: r.dim, count: 0, uniques: 0 };
    d.count += r.count;
    d.uniques += r.uniques;
    by.set(r.dim, d);
  }
  const sorted = [...by.values()].sort((a, b) => b.count - a.count || a.dim.localeCompare(b.dim));
  // "Other pages" always goes last.
  return [...sorted.filter((d) => d.dim !== OTHER_DIM).slice(0, limit), ...sorted.filter((d) => d.dim === OTHER_DIM)];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const range = (p: Period) => ({ from: p.from, to: p.to });
const startOf = (d: string) => new Date(dayMs(d));
const endOf = (d: string) => new Date(dayMs(d) + DAY_MS - 1);

// ------------------------------------------------------------------ one object

/** Ratings of a form's submissions in a period: testimonials and the private low-rating feedback, so a diverted 1-star still counts. */
function formRating(formId: string, p: Period) {
  const db = getDb();
  const t = db
    .select({ sum: sql<number>`COALESCE(SUM(${testimonials.rating}), 0)`, n: sql<number>`COUNT(${testimonials.rating})` })
    .from(testimonials)
    .where(and(eq(testimonials.formId, formId), ne(testimonials.status, "trashed"), between(testimonials.createdAt, startOf(p.from), endOf(p.to))))
    .get()!;
  const f = db
    .select({ sum: sql<number>`COALESCE(SUM(${feedback.rating}), 0)`, n: sql<number>`COUNT(${feedback.rating})` })
    .from(feedback)
    .where(and(eq(feedback.formId, formId), isNull(feedback.trashedAt), between(feedback.createdAt, startOf(p.from), endOf(p.to))))
    .get()!;
  const count = t.n + f.n;
  return { average: count ? Math.round(((t.sum + f.sum) / count) * 10) / 10 : null, count };
}

export type ObjectSummary = {
  views: number;
  visitors: number;
  clicks: Partial<Record<AnalyticsMetric, number>>;
  starts: number;
  completions: number;
  completionRate: number | null;
  renders: number;
  dropped: number;
};

function summary(t: MetricTotals, clickMetrics: readonly AnalyticsMetric[]): ObjectSummary {
  return {
    views: n(t, "view"),
    visitors: u(t, "view") || u(t, "render"),
    clicks: Object.fromEntries(clickMetrics.map((m) => [m, n(t, m)])),
    starts: n(t, "start"),
    completions: n(t, "complete"),
    completionRate: pct(n(t, "complete"), n(t, "view")),
    renders: n(t, "render"),
    dropped: n(t, "dropped"),
  };
}

const CLICKS_OF: Record<AnalyticsObject, readonly AnalyticsMetric[]> = { widget: WIDGET_CLICKS, wall: ["cta", "link"], form: [], snippet: [], testimonial: ["cta", "share"] };

/**
 * One widget, form, wall or snippet over a period, with the previous period
 * to compare: totals, a daily series, top pages (widgets), per-page
 * drop-off and ratings (forms), referring sites (snippets).
 */
export function objectReport(type: AnalyticsObject, id: string, projectId: string, p: Period, now = new Date()) {
  const prev = previousPeriod(p);
  const scope: Scope = { projectIds: [projectId], object: { type, id }, dims: true };
  const rows = readTotals(p, scope, now);
  const before = readTotals(prev, { ...scope, dims: false }, now);
  const totals = rows.filter((r) => !r.dim);
  const clickMetrics = CLICKS_OF[type];
  const out = {
    type,
    id,
    range: range(p),
    previousRange: range(prev),
    days: p.days,
    current: summary(sumMetrics(totals), clickMetrics),
    previous: summary(sumMetrics(before), clickMetrics),
    series: {
      views: dailySeries(totals, p.days, type === "snippet" ? "render" : "view"),
      visitors: dailySeries(totals, p.days, type === "snippet" ? "render" : "view", "uniques"),
      clicks: dailySeries(totals, p.days, [...clickMetrics]),
      completions: dailySeries(totals, p.days, "complete"),
      previousViews: dailySeries(before, prev.days, type === "snippet" ? "render" : "view"),
    },
    topPages: type === "widget" ? topDims(rows, "view") : [],
    sites: type === "snippet" ? topDims(rows, "render") : [],
    funnel: null as null | { pages: { index: number; label: string; visitors: number }[]; completions: number; rating: { average: number | null; count: number }; previousRating: { average: number | null; count: number } },
    install: null as InstallStatus | null,
  };
  if (type === "form") {
    const form = getDb().select().from(forms).where(eq(forms.id, id)).get();
    const steps = new Map(topDims(rows, "step", 100).map((d) => [d.dim, d.uniques]));
    const cfg = form && form.layout === "steps" ? parseFormRow(form) : null;
    // Indexes into form.pages, as the runner sends them; the low-rating step comes after them all.
    const pages = (cfg?.pages ?? []).flatMap((pg, i) => (pg.type !== "thank_you" && pageEnabled(pg) ? [{ index: i, label: pageLabel(pg) }] : []));
    if (cfg?.settings.lowRating?.enabled) pages.push({ index: cfg.pages.length, label: "Private feedback (low ratings)" });
    out.funnel = {
      pages: pages.map((pg, i) => ({ ...pg, label: `${i + 1}. ${pg.label}`, visitors: steps.get(String(pg.index)) ?? 0 })),
      completions: out.current.completions,
      rating: formRating(id, p),
      previousRating: formRating(id, prev),
    };
  }
  if (type === "widget") {
    const w = getDb().select().from(widgets).where(eq(widgets.id, id)).get();
    if (w) out.install = installStatus(w, now);
  }
  return out;
}
export type ObjectReport = ReturnType<typeof objectReport>;

/** A form page as the drop-off chart names it. */
const PAGE_NAMES: Record<PageType, string> = {
  welcome: "Welcome",
  rating: "Rating",
  question: "Question",
  feedback: "Private question",
  consent: "Consent",
  about_you: "About you",
  about_company: "About your company",
  review: "Review and send",
  thank_you: "Thank you",
};

function pageLabel(pg: FormPage): string {
  const title = "title" in pg && typeof pg.title === "string" ? pg.title.trim() : "";
  const base = PAGE_NAMES[pg.type];
  return title ? `${base}: ${title.length > 48 ? `${title.slice(0, 47)}…` : title}` : base;
}

// ------------------------------------------------------------------ dashboard (AN-01)

const SOURCE_GROUPS = ["form", "import", "manual", "api"] as const;
const groupOf = (source: string) => (source.startsWith("import") ? "import" : (SOURCE_GROUPS as readonly string[]).includes(source) ? source : "other");

function newTestimonials(projectIds: string[], p: Period) {
  const rows = getDb()
    .select({ source: testimonials.source, n: sql<number>`COUNT(*)` })
    .from(testimonials)
    .where(and(inArray(testimonials.projectId, projectIds), ne(testimonials.status, "trashed"), between(testimonials.createdAt, startOf(p.from), endOf(p.to))))
    .groupBy(testimonials.source)
    .all();
  const bySource: Record<string, number> = { form: 0, import: 0, manual: 0, api: 0, other: 0 };
  for (const r of rows) bySource[groupOf(r.source)] += r.n;
  return { total: rows.reduce((a, r) => a + r.n, 0), bySource };
}

function averageRating(projectIds: string[], p: Period) {
  const db = getDb();
  const t = db
    .select({ sum: sql<number>`COALESCE(SUM(${testimonials.rating}), 0)`, n: sql<number>`COUNT(${testimonials.rating})` })
    .from(testimonials)
    .where(and(inArray(testimonials.projectId, projectIds), ne(testimonials.status, "trashed"), between(testimonials.createdAt, startOf(p.from), endOf(p.to))))
    .get()!;
  const f = db
    .select({ sum: sql<number>`COALESCE(SUM(${feedback.rating}), 0)`, n: sql<number>`COUNT(${feedback.rating})` })
    .from(feedback)
    .where(and(inArray(feedback.projectId, projectIds), isNull(feedback.trashedAt), between(feedback.createdAt, startOf(p.from), endOf(p.to))))
    .get()!;
  const count = t.n + f.n;
  return { average: count ? Math.round(((t.sum + f.sum) / count) * 10) / 10 : null, count };
}

/** Waiting for review right now (not a period number), and how long the oldest has waited. */
function backlog(projectIds: string[], now: Date) {
  const r = getDb()
    .select({ n: sql<number>`COUNT(*)`, oldest: sql<number | null>`MIN(${testimonials.createdAt})` })
    .from(testimonials)
    .where(and(inArray(testimonials.projectId, projectIds), eq(testimonials.status, "pending")))
    .get()!;
  return { pending: r.n, oldestDays: r.oldest ? Math.floor((now.getTime() - r.oldest) / DAY_MS) : null };
}

/** M10's daily booster click counts, summed. */
function boosterClickTotal(projectIds: string[], p: Period) {
  return (
    getDb()
      .select({ n: sql<number>`COALESCE(SUM(${boosterClicks.count}), 0)` })
      .from(boosterClicks)
      .innerJoin(boosters, eq(boosters.id, boosterClicks.boosterId))
      .where(and(inArray(boosters.projectId, projectIds), between(boosterClicks.day, p.from, p.to)))
      .get()?.n ?? 0
  );
}

/** M9's funnel for the invitations sent in the period, campaign by campaign (open tracking is per campaign), then added up. */
function inviteFunnel(projectIds: string[], p: Period) {
  const db = getDb();
  const rows = db
    .select()
    .from(requests)
    .where(and(inArray(requests.projectId, projectIds), isNotNull(requests.campaignId), between(requests.sentAt, startOf(p.from), endOf(p.to))))
    .all();
  const list = db.select({ id: campaigns.id, trackOpens: campaigns.trackOpens }).from(campaigns).where(inArray(campaigns.projectId, projectIds)).all();
  let opened: number | null = null;
  const sum = { sent: 0, clicked: 0, started: 0, submitted: 0, declined: 0 };
  for (const c of list) {
    const f = funnelOf(rows.filter((r) => r.campaignId === c.id), c.trackOpens);
    sum.sent += f.sent;
    sum.clicked += f.clicked;
    sum.started += f.started;
    sum.submitted += f.submitted;
    sum.declined += f.declined;
    if (f.opened !== null) opened = (opened ?? 0) + f.opened;
  }
  return { ...sum, opened };
}

function typeTiles(rows: TotalRow[]) {
  // The project totals (object_id "") count a visitor once across a type's objects.
  const of = (type: AnalyticsObject) => sumMetrics(rows, (r) => r.objectType === type && r.objectId === "");
  const w = of("widget");
  const f = of("form");
  const wl = of("wall");
  const s = sumMetrics(rows, (r) => r.objectType === "snippet" && r.objectId !== "");
  const dropped = rows.filter((r) => r.metric === "dropped").reduce((a, r) => a + r.count, 0);
  return {
    widgets: { views: n(w, "view"), visitors: u(w, "view"), clicks: WIDGET_CLICKS.reduce((a, m) => a + n(w, m), 0) },
    forms: { views: n(f, "view"), visitors: u(f, "view"), starts: n(f, "start"), completions: n(f, "complete"), completionRate: pct(n(f, "complete"), n(f, "view")) },
    walls: { views: n(wl, "view"), visitors: u(wl, "view"), ctaClicks: n(wl, "cta"), linkClicks: n(wl, "link") },
    snippets: { renders: n(s, "render") },
    dropped,
  };
}

function perObject(rows: TotalRow[], type: AnalyticsObject) {
  const by = new Map<string, MetricTotals>();
  for (const r of rows) {
    if (r.objectType !== type || !r.objectId) continue;
    const t = by.get(r.objectId) ?? {};
    const m = (t[r.metric] ??= { count: 0, uniques: 0 });
    m.count += r.count;
    m.uniques += r.uniques;
    by.set(r.objectId, t);
  }
  return by;
}

/** The whole /admin/analytics page for some projects and a period. */
export function dashboardReport(projectIds: string[], p: Period, now = new Date()) {
  const prev = previousPeriod(p);
  const scope: Scope = { projectIds };
  const rows = readTotals(p, scope, now);
  const before = readTotals(prev, scope, now);
  const db = getDb();
  const projectRows = projectIds.length
    ? db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(inArray(schema.projects.id, projectIds)).all()
    : [];
  const projectName = new Map(projectRows.map((r) => [r.id, r.name]));
  const ids = projectIds.length ? projectIds : ["-"];

  const wRows = perObject(rows, "widget");
  const fRows = perObject(rows, "form");
  const lRows = perObject(rows, "wall");
  const empty: MetricTotals = {};

  const widgetList = db.select().from(widgets).where(and(inArray(widgets.projectId, ids), isNull(widgets.deletedAt))).orderBy(asc(widgets.createdAt)).all();
  const formList = db.select().from(forms).where(inArray(forms.projectId, ids)).orderBy(asc(forms.createdAt)).all();
  const wallList = db.select().from(walls).where(inArray(walls.projectId, ids)).orderBy(asc(walls.createdAt)).all();

  const series = {
    views: dailySeries(rows.filter((r) => r.objectId === "" && r.objectType !== "snippet"), p.days, "view"),
    previousViews: dailySeries(before.filter((r) => r.objectId === "" && r.objectType !== "snippet"), prev.days, "view"),
  };

  return {
    range: range(p),
    previousRange: range(prev),
    days: p.days,
    projects: projectRows,
    tiles: {
      testimonials: { current: newTestimonials(ids, p), previous: newTestimonials(ids, prev) },
      backlog: backlog(ids, now),
      rating: { current: averageRating(ids, p), previous: averageRating(ids, prev) },
      ...typeTiles(rows),
      previous: typeTiles(before),
      booster: { current: boosterClickTotal(ids, p), previous: boosterClickTotal(ids, prev) },
      invites: { current: inviteFunnel(ids, p), previous: inviteFunnel(ids, prev) },
    },
    series,
    tables: {
      widgets: widgetList.map((w) => widgetRow(w, wRows.get(w.id) ?? empty, projectName.get(w.projectId) ?? "", now)),
      forms: formList.map((f) => {
        const t = fRows.get(f.id) ?? empty;
        const rating = formRating(f.id, p);
        return {
          id: f.id,
          projectId: f.projectId,
          project: projectName.get(f.projectId) ?? "",
          name: f.name,
          layout: f.layout,
          views: n(t, "view"),
          visitors: u(t, "view"),
          starts: f.layout === "steps" ? n(t, "start") : null,
          completions: n(t, "complete"),
          completionRate: pct(n(t, "complete"), n(t, "view")),
          rating: rating.average,
        };
      }),
      walls: wallList.map((w) => {
        const t = lRows.get(w.id) ?? empty;
        return {
          id: w.id,
          projectId: w.projectId,
          project: projectName.get(w.projectId) ?? "",
          name: w.name,
          published: w.published,
          views: n(t, "view"),
          visitors: u(t, "view"),
          ctaClicks: n(t, "cta"),
          linkClicks: n(t, "link"),
        };
      }),
    },
  };
}
export type DashboardReport = ReturnType<typeof dashboardReport>;

function widgetRow(w: Widget, t: MetricTotals, project: string, now: Date) {
  const install = installStatus(w, now);
  return {
    id: w.id,
    projectId: w.projectId,
    project,
    name: w.name,
    layout: w.layout,
    views: n(t, "view"),
    visitors: u(t, "view"),
    clicks: WIDGET_CLICKS.reduce((a, m) => a + n(t, m), 0),
    ctr: pct(WIDGET_CLICKS.reduce((a, m) => a + n(t, m), 0), n(t, "view")),
    state: install.state,
    page: install.lastSeenPage,
  };
}

/** Snippet render counts for a project's snippets over a period (SEO-04), for the SEO page. */
export function snippetRenders(projectId: string, p: Period, now = new Date()) {
  const rows = readTotals(p, { projectIds: [projectId], type: "snippet" }, now);
  const out: Record<string, number> = {};
  const list = getDb().select({ id: seoSnippets.id }).from(seoSnippets).where(eq(seoSnippets.projectId, projectId)).all();
  for (const s of list) out[s.id] = 0;
  for (const r of rows) if (r.objectId && r.metric === "render" && r.objectId in out) out[r.objectId] += r.count;
  return out;
}


/** DISP-12, DISP-13: each widget's install state and its views in the last 30 days, for the widget list. */
export function widgetSummaries(projectId: string, now = new Date()) {
  const p = parseRange(null, null, now);
  const views = new Map<string, number>();
  for (const r of readTotals(p, { projectIds: [projectId], type: "widget" }, now)) {
    if (r.objectId && r.metric === "view") views.set(r.objectId, (views.get(r.objectId) ?? 0) + r.count);
  }
  const list = getDb().select().from(widgets).where(and(eq(widgets.projectId, projectId), isNull(widgets.deletedAt))).all();
  return Object.fromEntries(
    list.map((w) => {
      const s = installStatus(w, now);
      return [w.id, { state: s.state, page: s.lastSeenPage, views: views.get(w.id) ?? 0 }];
    }),
  );
}
export type WidgetSummary = ReturnType<typeof widgetSummaries>[string];
