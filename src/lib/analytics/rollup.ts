import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { AnalyticsMetric, AnalyticsObject, Widget } from "@/db/schema";
import { env } from "../env";
import { notifyWidgetRemoved } from "../notifications";
import { getProjectById } from "../testimonials";
import { emitEvent } from "../webhooks";
import { collecting, isOwnPage, originOf, RETENTION_DAYS, utcDay } from "./collect";

const { analyticsEvents, analyticsDaily, analyticsSalts, analyticsRollups, widgets } = schema;

/**
 * Turning raw events into daily totals (the hourly `analytics.rollup` task),
 * deleting old raw events and salts, and install detection (DISP-13).
 *
 * Caps live here, in the totals, rather than in what's collected: one visitor
 * counts at most VISITOR_DAY_CAP times per metric per object per day (a
 * reload loop isn't an audience), and a day keeps its DIMS_PER_DAY busiest
 * pages per object; the rest add up under "Other pages".
 */

export const VISITOR_DAY_CAP = 50;
export const DIMS_PER_DAY = 100;
export const OTHER_DIM = "(other)";
/** Metrics whose `dim` is worth keeping per day: widget pages, form pages, snippet sites. */
const DIM_METRICS: AnalyticsMetric[] = ["view", "step", "render"];
/** A widget that was live and gets no view for this long is reported removed. */
export const REMOVED_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

export const ROLLUP_TASK = "analytics.rollup";

export type TotalRow = {
  projectId: string;
  objectType: AnalyticsObject;
  /** "" = the project's total for the type (visitors counted once across its objects). */
  objectId: string;
  day: string;
  metric: AnalyticsMetric;
  dim: string;
  count: number;
  uniques: number;
};

export type RawScope = { projectIds?: string[] | null; object?: { type: AnalyticsObject; id: string }; dims?: boolean; totals?: boolean };

const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

function whereOf(days: string[], s: RawScope): SQL {
  const parts: SQL[] = [sql`day IN (${list(days)})`, sql`metric != 'dropped'`];
  if (s.projectIds) parts.push(s.projectIds.length ? sql`project_id IN (${list(s.projectIds)})` : sql`0`);
  if (s.object) parts.push(sql`object_type = ${s.object.type} AND object_id = ${s.object.id}`);
  return sql.join(parts, sql` AND `);
}

/**
 * Capped totals straight from raw events: per object and metric, the
 * project's per-type totals (`totals`), and per page (`dims`). The rollup
 * stores exactly this; the dashboard calls it for days not rolled up yet
 * (today), so both read the same numbers.
 */
export function aggregateRaw(days: string[], scope: RawScope = {}): TotalRow[] {
  if (!days.length) return [];
  const db = getDb();
  const w = whereOf(days, scope);
  // The GROUP BY order follows analytics_events_day_idx, so SQLite reads it in order.
  const perObject = db.all<TotalRow>(sql`
    SELECT project_id AS projectId, object_type AS objectType, object_id AS objectId, day, metric, '' AS dim,
      SUM(MIN(n, ${VISITOR_DAY_CAP})) AS count, COUNT(*) AS uniques
    FROM (
      SELECT day, project_id, object_type, metric, visitor, object_id, COUNT(*) AS n
      FROM analytics_events WHERE ${w}
      GROUP BY day, project_id, object_type, metric, visitor, object_id
    )
    GROUP BY day, project_id, object_type, object_id, metric`);
  const out: TotalRow[] = [...perObject];

  if (scope.totals !== false && !scope.object) {
    const uniques = db.all<{ projectId: string; objectType: AnalyticsObject; day: string; metric: AnalyticsMetric; uniques: number }>(sql`
      SELECT project_id AS projectId, object_type AS objectType, day, metric, COUNT(DISTINCT visitor) AS uniques
      FROM analytics_events WHERE ${w}
      GROUP BY day, project_id, object_type, metric`);
    const sums = new Map<string, number>();
    for (const r of perObject) {
      const k = `${r.projectId}|${r.objectType}|${r.day}|${r.metric}`;
      sums.set(k, (sums.get(k) ?? 0) + r.count);
    }
    for (const u of uniques) {
      out.push({ ...u, objectId: "", dim: "", count: sums.get(`${u.projectId}|${u.objectType}|${u.day}|${u.metric}`) ?? 0 });
    }
  }

  if (scope.dims) {
    const rows = db.all<TotalRow>(sql`
      SELECT project_id AS projectId, object_type AS objectType, object_id AS objectId, day, metric, dim,
        SUM(MIN(n, ${VISITOR_DAY_CAP})) AS count, COUNT(*) AS uniques
      FROM (
        SELECT day, project_id, object_type, metric, visitor, object_id, dim, COUNT(*) AS n
        FROM analytics_events WHERE ${w} AND dim != '' AND metric IN (${list(DIM_METRICS)})
        GROUP BY day, project_id, object_type, metric, visitor, object_id, dim
      )
      GROUP BY day, project_id, object_type, object_id, metric, dim`);
    out.push(...capDims(rows));
  }
  return out;
}

/** Keeps each object's DIMS_PER_DAY busiest dims per day and metric, and adds the rest up as OTHER_DIM. */
export function capDims(rows: TotalRow[]): TotalRow[] {
  const groups = new Map<string, TotalRow[]>();
  for (const r of rows) {
    const k = `${r.projectId}|${r.objectType}|${r.objectId}|${r.day}|${r.metric}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: TotalRow[] = [];
  for (const g of groups.values()) {
    if (g.length <= DIMS_PER_DAY) {
      out.push(...g);
      continue;
    }
    g.sort((a, b) => b.count - a.count || a.dim.localeCompare(b.dim));
    out.push(...g.slice(0, DIMS_PER_DAY));
    const rest = g.slice(DIMS_PER_DAY);
    // Visitors may overlap between the merged pages; the sum is an upper bound, which is fine for "Other".
    out.push({ ...rest[0], dim: OTHER_DIM, count: rest.reduce((n, r) => n + r.count, 0), uniques: rest.reduce((n, r) => n + r.uniques, 0) });
  }
  return out;
}

// ------------------------------------------------------------------ rollup

/**
 * Finished days (before today) with no rollup yet: each of the last
 * RETENTION_DAYS + 1 days, plus any older day that still has raw events (a
 * worker that was off for a long time), so nothing is left unrolled and
 * never deleted.
 */
function daysToRoll(now: Date): string[] {
  const db = getDb();
  const done = new Set(db.select({ day: analyticsRollups.day }).from(analyticsRollups).all().map((r) => r.day));
  const first = utcDay(new Date(now.getTime() - (RETENTION_DAYS + 1) * DAY_MS));
  // Normally empty: older days are deleted once rolled.
  const older = db.all<{ day: string }>(sql`SELECT DISTINCT day FROM analytics_events WHERE day < ${first}`).map((r) => r.day);
  const out = older.filter((d) => !done.has(d));
  for (let i = RETENTION_DAYS + 1; i >= 1; i--) {
    const day = utcDay(new Date(now.getTime() - i * DAY_MS));
    if (!done.has(day)) out.push(day);
  }
  return out;
}

/**
 * Rolls each finished day up into analytics_daily, once. Events are dated
 * when they arrive, so a finished day never changes. Returns the days rolled.
 */
export function rollupDays(now = new Date()): string[] {
  const db = getDb();
  const rolled: string[] = [];
  for (const day of daysToRoll(now)) {
    const events = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM analytics_events WHERE day = ${day}`)?.n ?? 0;
    const rows = events ? aggregateRaw([day], { dims: true }) : [];
    db.transaction((tx) => {
      // "dropped" rows are written as events arrive, so they stay.
      tx.delete(analyticsDaily).where(and(eq(analyticsDaily.day, day), ne(analyticsDaily.metric, "dropped"))).run();
      for (let i = 0; i < rows.length; i += 500) tx.insert(analyticsDaily).values(rows.slice(i, i + 500)).run();
      tx.insert(analyticsRollups)
        .values({ day, events, rolledAt: now })
        .onConflictDoUpdate({ target: analyticsRollups.day, set: { events, rolledAt: now } })
        .run();
    });
    rolled.push(day);
  }
  return rolled;
}

/** Deletes raw events older than RETENTION_DAYS (only days already rolled up) and salts older than yesterday. */
export function purgeOld(now = new Date()) {
  const db = getDb();
  const cutoff = utcDay(new Date(now.getTime() - RETENTION_DAYS * DAY_MS));
  const events = db
    .delete(analyticsEvents)
    .where(and(lt(analyticsEvents.day, cutoff), inArray(analyticsEvents.day, db.select({ day: analyticsRollups.day }).from(analyticsRollups))))
    .run().changes;
  const yesterday = utcDay(new Date(now.getTime() - DAY_MS));
  const salts = db.delete(analyticsSalts).where(lt(analyticsSalts.day, yesterday)).run().changes;
  return { events, salts };
}

// ------------------------------------------------------------------ installs (DISP-13)

const split = (page: string) => {
  const origin = originOf(page);
  return { origin, path: page.slice(origin.length) || "/" };
};

function widgetData(w: Widget, page: string | null) {
  const p = page ? split(page) : null;
  return {
    widget: { id: w.id, name: w.name, layout: w.layout },
    page: p ? { url: `${p.origin}${p.path}`, origin: p.origin, path: p.path } : null,
    lastSeenAt: w.lastSeenAt?.toISOString() ?? null,
  };
}

/**
 * Brings each widget's "last seen" up to date from the newest views (not on
 * this server's own pages), and sends `widget.installed` when a widget is
 * seen for the first time or again after it was reported removed.
 */
export function updateInstalls(now = new Date()) {
  const db = getDb();
  const own = originOf(env.publicUrl);
  const since = utcDay(new Date(now.getTime() - DAY_MS));
  // SQLite returns the dim of the row holding MAX(at).
  const latest = db.all<{ id: string; dim: string; at: number }>(sql`
    SELECT object_id AS id, dim, MAX(at) AS at FROM analytics_events
    WHERE object_type = 'widget' AND metric = 'view' AND day >= ${since} AND dim != '' AND substr(dim, 1, ${own.length}) != ${own}
    GROUP BY object_id`);
  let installed = 0;
  for (const r of latest) {
    const w = db.select().from(widgets).where(eq(widgets.id, r.id)).get();
    if (!w || w.deletedAt || (w.lastSeenAt && w.lastSeenAt.getTime() >= r.at)) continue;
    const { origin, path } = split(r.dim);
    const back = !w.lastSeenAt || Boolean(w.removedAt);
    const next = db
      .update(widgets)
      .set({ lastSeenAt: new Date(r.at), lastSeenOrigin: origin, lastSeenPath: path, removedAt: null, removedDismissed: false })
      .where(eq(widgets.id, w.id))
      .returning()
      .get();
    if (back) {
      emitEvent("widget.installed", getProjectById(w.projectId), widgetData(next, r.dim));
      installed++;
    }
  }
  return installed;
}

/** Widgets live once and unseen for REMOVED_AFTER_DAYS: marked, `widget.removed` sent, and an email to whoever wants one (INT-01). */
export function checkRemoved(now = new Date()) {
  const db = getDb();
  const stale = db
    .select()
    .from(widgets)
    .where(and(isNotNull(widgets.lastSeenAt), isNull(widgets.removedAt), isNull(widgets.deletedAt), lt(widgets.lastSeenAt, new Date(now.getTime() - REMOVED_AFTER_DAYS * DAY_MS))))
    .all();
  for (const w of stale) {
    db.update(widgets).set({ removedAt: now, removedDismissed: false }).where(eq(widgets.id, w.id)).run();
    const page = w.lastSeenOrigin ? `${w.lastSeenOrigin}${w.lastSeenPath ?? ""}` : null;
    emitEvent("widget.removed", getProjectById(w.projectId), widgetData(w, page));
    notifyWidgetRemoved(w.projectId, w.id);
  }
  return stale.length;
}

/** The hourly task: install detection while collecting, the rollup, then deleting old raw data (always, so switching off still cleans up). */
export function runAnalyticsTask(now = new Date()) {
  const out = { installed: 0, removed: 0, rolled: [] as string[], purged: { events: 0, salts: 0 } };
  if (collecting()) {
    out.installed = updateInstalls(now);
    out.removed = checkRemoved(now);
  }
  out.rolled = rollupDays(now);
  out.purged = purgeOld(now);
  return out;
}

// ------------------------------------------------------------------ install status for the dashboard

export type InstallPage = { page: string; lastSeen: string; views: number };
export type InstallStatus = {
  state: "live" | "removed" | "never";
  /** Pages it was seen on in the last 7 days, newest first (this server's own pages left out). */
  pages: InstallPage[];
  /** Views on this server's own hosted link in the same days. */
  hostedViews: number;
  lastSeenAt: string | null;
  lastSeenPage: string | null;
  removedAt: string | null;
  removedDismissed: boolean;
};

/** "Live on example.com/pricing": the widget row plus the last 7 days of raw views, so it's current between rollups. */
export function installStatus(w: Widget, now = new Date()): InstallStatus {
  const since = utcDay(new Date(now.getTime() - REMOVED_AFTER_DAYS * DAY_MS));
  const rows = getDb()
    .select({ page: analyticsEvents.dim, at: sql<number>`MAX(${analyticsEvents.at})`, views: sql<number>`COUNT(*)` })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.objectType, "widget"), eq(analyticsEvents.objectId, w.id), sql`${analyticsEvents.day} >= ${since}`, eq(analyticsEvents.metric, "view"), ne(analyticsEvents.dim, "")))
    .groupBy(analyticsEvents.dim)
    .orderBy(desc(sql`MAX(${analyticsEvents.at})`))
    .limit(25)
    .all();
  const pages = rows.filter((r) => !isOwnPage(r.page)).map((r) => ({ page: r.page, lastSeen: new Date(r.at).toISOString(), views: r.views }));
  const hostedViews = rows.filter((r) => isOwnPage(r.page)).reduce((n, r) => n + r.views, 0);
  const newest = pages[0] ? new Date(pages[0].lastSeen) : null;
  const lastSeen = newest && (!w.lastSeenAt || newest > w.lastSeenAt) ? newest : w.lastSeenAt;
  const lastPage = newest && lastSeen === newest ? pages[0].page : w.lastSeenOrigin ? `${w.lastSeenOrigin}${w.lastSeenPath ?? ""}` : null;
  const fresh = lastSeen && now.getTime() - lastSeen.getTime() < REMOVED_AFTER_DAYS * DAY_MS;
  const back = w.removedAt && newest && newest > w.removedAt;
  return {
    state: fresh && (!w.removedAt || back) ? "live" : w.removedAt ? "removed" : lastSeen ? "live" : "never",
    pages: pages.slice(0, 10),
    hostedViews,
    lastSeenAt: lastSeen?.toISOString() ?? null,
    lastSeenPage: lastPage,
    removedAt: back ? null : (w.removedAt?.toISOString() ?? null),
    removedDismissed: w.removedDismissed,
  };
}

/** Removed widgets whose alert the owner hasn't hidden: the in-app alerts (DISP-13). */
export function removedAlerts(projectIds?: string[]) {
  const db = getDb();
  const rows = db
    .select()
    .from(widgets)
    .where(and(isNotNull(widgets.removedAt), eq(widgets.removedDismissed, false), isNull(widgets.deletedAt), projectIds ? inArray(widgets.projectId, projectIds) : undefined))
    .orderBy(desc(widgets.removedAt))
    .all();
  return rows.map((w) => ({
    widgetId: w.id,
    projectId: w.projectId,
    name: w.name,
    page: w.lastSeenOrigin ? `${w.lastSeenOrigin}${w.lastSeenPath ?? ""}` : null,
    lastSeenAt: w.lastSeenAt?.toISOString() ?? null,
    removedAt: w.removedAt!.toISOString(),
  }));
}
export type RemovedAlert = ReturnType<typeof removedAlerts>[number];

/** Hides a removal alert (the widget stays marked removed until it's seen again). */
export function dismissRemoved(widgetId: string): boolean {
  return getDb().update(widgets).set({ removedDismissed: true }).where(and(eq(widgets.id, widgetId), isNotNull(widgets.removedAt))).run().changes > 0;
}
