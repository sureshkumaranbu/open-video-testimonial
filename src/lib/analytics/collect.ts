import crypto from "node:crypto";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { AnalyticsMetric, AnalyticsObject } from "@/db/schema";
import { env } from "../env";
import { clientIpFrom, clientKey, rateLimit } from "../rate-limit";

const { analyticsEvents, analyticsDaily, analyticsSalts, widgets, forms, walls, seoSnippets } = schema;

/**
 * Cookieless event collection (M11, PRD §15; what is and isn't kept is in
 * docs/help/analytics.md). A visitor is a hash of IP + user agent + project
 * with a random salt that changes every UTC day and is deleted after two, so
 * the hash can't be reversed or matched across days; neither the address
 * nor the user agent is stored. Paths never keep their query or fragment.
 */

/** Raw events are deleted after this many days; the daily totals stay. */
export const RETENTION_DAYS = 30;
/**
 * Raw events stored per widget, form, wall or snippet per UTC day. Real
 * traffic stays far below it; past it events are only counted as "dropped"
 * (shown on the dashboard), so one script can't fill the database.
 */
export const DAILY_EVENT_CAP = 50_000;
/** Beacons per address in 10 minutes (about one a second, enough for an office behind one address). */
export const BEACONS_PER_WINDOW = 600;
export const BEACON_WINDOW_MS = 10 * 60 * 1000;
/** Bodies are a few dozen bytes; anything past this isn't ours. */
export const MAX_BEACON_BYTES = 2048;
/** Paths are cut to this length. */
const MAX_PATH = 300;

/** UTC day, YYYY-MM-DD. */
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Whether this server collects anything at all (ANALYTICS=off says no). */
export const collecting = () => env.analytics;

// ------------------------------------------------------------------ visitors

let salt: { key: string; value: string } | null = null;

/** Today's salt: made on first use (random, server-side only), then read back so every process agrees. */
export function saltFor(day: string): string {
  const key = `${env.databasePath}|${day}`;
  if (salt?.key === key) return salt.value;
  const db = getDb();
  db.insert(analyticsSalts).values({ day, salt: crypto.randomBytes(32).toString("base64url"), createdAt: new Date() }).onConflictDoNothing().run();
  const row = db.select().from(analyticsSalts).where(eq(analyticsSalts.day, day)).get()!;
  salt = { key, value: row.salt };
  return row.salt;
}

/** The day's visitor id: 22 characters of SHA-256 over salt, IP, user agent and project. */
export function visitorHash(day: string, ip: string | null, ua: string, projectId: string): string {
  return crypto.createHash("sha256").update(`${saltFor(day)}\n${ip ?? ""}\n${ua}\n${projectId}`).digest("base64url").slice(0, 22);
}

/**
 * Crawlers, link previews and uptime checks aren't visitors. Snippet renders
 * are the exception (search engines are who they're for), so they skip this.
 */
const BOT = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|pingdom|curl\/|wget|python-|go-http-client|okhttp|axios|node-fetch|lighthouse|pagespeed/i;
export const isBot = (ua: string) => BOT.test(ua);

// ------------------------------------------------------------------ pages

/** "https://example.com/pricing" from any http(s) URL: the origin and the path, never the query or fragment. "" if it isn't one. */
export function pageOf(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > 4096) return "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  return u.origin + u.pathname.slice(0, MAX_PATH);
}

/** The origin alone ("https://example.com"), or "". */
export function originOf(raw: unknown): string {
  const page = pageOf(raw);
  return page ? new URL(page).origin : "";
}

/** "example.com/pricing" for people to read. */
export function shortPage(page: string): string {
  return page.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || page;
}

/** Whether a page is on this server itself (the hosted widget link, the admin): never proof of an install. */
export function isOwnPage(page: string): boolean {
  return Boolean(page) && originOf(page) === originOf(env.publicUrl);
}

// ------------------------------------------------------------------ storing

export type EventInput = {
  projectId: string;
  type: AnalyticsObject;
  id: string;
  metric: AnalyticsMetric;
  dim?: string;
  ip: string | null;
  ua: string;
  now?: Date;
};

// How many events each object has stored today, so the cap costs one COUNT per object per day.
let counts: { key: string; map: Map<string, number> } = { key: "", map: new Map() };

function storedToday(type: AnalyticsObject, id: string, day: string): number {
  const key = `${env.databasePath}|${day}`;
  if (counts.key !== key) counts = { key, map: new Map() };
  const k = `${type}:${id}`;
  let n = counts.map.get(k);
  if (n === undefined) {
    n = getDb()
      .select({ n: count() })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.objectType, type), eq(analyticsEvents.objectId, id), eq(analyticsEvents.day, day)))
      .get()!.n;
  }
  counts.map.set(k, n + 1);
  return n;
}

/** Test helper: forget the in-memory counters (as a restart does). */
export function resetCollectState() {
  counts = { key: "", map: new Map() };
  salt = null;
}

/** Stores one event (one insert), or past the daily cap only adds to the "dropped" count. Returns whether it was stored. */
export function recordEvent(e: EventInput): boolean {
  if (!collecting()) return false;
  const now = e.now ?? new Date();
  const day = utcDay(now);
  const db = getDb();
  if (storedToday(e.type, e.id, day) >= DAILY_EVENT_CAP) {
    db.insert(analyticsDaily)
      .values({ projectId: e.projectId, objectType: e.type, objectId: e.id, day, metric: "dropped", dim: "", count: 1, uniques: 0 })
      .onConflictDoUpdate({
        target: [analyticsDaily.projectId, analyticsDaily.objectType, analyticsDaily.objectId, analyticsDaily.day, analyticsDaily.metric, analyticsDaily.dim],
        set: { count: sql`${analyticsDaily.count} + 1` },
      })
      .run();
    return false;
  }
  db.insert(analyticsEvents)
    .values({
      projectId: e.projectId,
      objectType: e.type,
      objectId: e.id,
      metric: e.metric,
      dim: (e.dim ?? "").slice(0, 400),
      visitor: visitorHash(day, e.ip, e.ua.slice(0, 512), e.projectId),
      day,
      at: now,
    })
    .run();
  return true;
}

/** The project an object belongs to, while it can be counted: a live widget, an existing form, a published wall, a snippet. */
export function objectProject(type: AnalyticsObject, id: string): string | null {
  if (!id || id.length > 64) return null;
  const db = getDb();
  const row =
    type === "widget"
      ? db.select({ p: widgets.projectId }).from(widgets).where(and(eq(widgets.id, id), isNull(widgets.deletedAt))).get()
      : type === "form"
        ? db.select({ p: forms.projectId }).from(forms).where(eq(forms.id, id)).get()
        : type === "wall"
          ? db.select({ p: walls.projectId }).from(walls).where(and(eq(walls.id, id), eq(walls.published, true))).get()
          : db.select({ p: seoSnippets.projectId }).from(seoSnippets).where(eq(seoSnippets.id, id)).get();
  return row?.p ?? null;
}

/** A browser fetching a page ahead of time, not someone looking at it. */
const isPrefetch = (h: Pick<Headers, "get">) =>
  Boolean(h.get("next-router-prefetch")) || /prefetch|prerender/i.test(`${h.get("sec-purpose") ?? ""} ${h.get("purpose") ?? ""}`);

/**
 * Counts something the server itself saw (a classic form view, a submission,
 * a snippet fetch). `bots` counts crawlers too. Never throws: analytics must
 * not break the page.
 */
export function recordServerEvent(headers: Pick<Headers, "get">, e: Omit<EventInput, "ip" | "ua" | "projectId"> & { projectId?: string; bots?: boolean }) {
  try {
    if (!collecting()) return;
    const ua = headers.get("user-agent") ?? "";
    if ((!e.bots && isBot(ua)) || (e.metric === "view" && isPrefetch(headers))) return;
    const projectId = e.projectId ?? objectProject(e.type, e.id);
    if (!projectId) return;
    recordEvent({ ...e, projectId, ip: clientIpFrom(headers), ua });
  } catch (err) {
    console.error("[analytics] couldn't record an event:", err);
  }
}

/** recordServerEvent() for a server page: its request's headers come from next/headers (none outside a request, e.g. in tests). */
export async function recordPageView(e: Omit<EventInput, "ip" | "ua" | "projectId" | "metric"> & { projectId: string }) {
  let h: Pick<Headers, "get">;
  try {
    h = await headers();
  } catch {
    return;
  }
  recordServerEvent(h, { ...e, metric: "view" });
}

// ------------------------------------------------------------------ beacons

/** Beacons get an empty answer, so nothing a page sends ever comes back. */
export const BEACON_HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
const empty = (status: number) => new Response(null, { status, headers: BEACON_HEADERS });

/**
 * widget.js: `{k, u}`, the kind and the page it's on. To stay small, widget.js
 * sends a clicked element's class (rm, src, b, bd); the names work as well.
 */
export const widgetBeacon = z.object({ k: z.enum(["view", "play", "more", "source", "cta", "rm", "src", "b", "bd"]), u: z.string().max(4096).optional() });
const WIDGET_KIND: Record<z.infer<typeof widgetBeacon>["k"], AnalyticsMetric> = { view: "view", play: "play", more: "more", source: "source", cta: "cta", rm: "more", src: "source", b: "cta", bd: "cta" };

/** Walls and step-by-step forms: `{t, id, k}`, plus the form page's index `s` for "step". */
export const pageBeacon = z.discriminatedUnion("t", [
  z.object({ t: z.literal("wall"), id: z.string().max(64), k: z.enum(["view", "cta", "link"]) }),
  z.object({ t: z.literal("form"), id: z.string().max(64), k: z.enum(["view", "start", "step"]), s: z.number().int().min(0).max(99).optional() }),
]);

/** The body as text, or null once it passes `max` bytes (it stops reading there, even without a Content-Length). */
async function readCapped(req: Request, max: number) {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function parseBody<T>(req: Request, schemaOf: z.ZodType<T>): Promise<T | null | "too-large"> {
  const raw = await readCapped(req, MAX_BEACON_BYTES);
  if (raw === null) return "too-large";
  try {
    const parsed = schemaOf.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Shared checks for both beacon routes: switched on, not a crawler, within the address's rate. Returns an answer to stop with, or null. */
function gate(req: Request): Response | null {
  if (!collecting()) return empty(204);
  if (isBot(req.headers.get("user-agent") ?? "")) return empty(204);
  if (!rateLimit(`beacon:${clientKey(req)}`, BEACONS_PER_WINDOW, BEACON_WINDOW_MS)) return empty(429);
  return null;
}

const ua = (req: Request) => req.headers.get("user-agent") ?? "";

/**
 * POST /api/widget/<id>/seen (DISP-13, DISP-14). A text/plain body, so the
 * browser sends it without a preflight. The page comes from the body (the
 * Origin header alone when it's missing); an unknown or deleted widget, or a
 * body that isn't ours, is ignored.
 */
export async function widgetBeaconResponse(req: Request, widgetId: string): Promise<Response> {
  const stop = gate(req);
  if (stop) return stop;
  const body = await parseBody(req, widgetBeacon);
  if (body === "too-large") return empty(413);
  if (!body) return empty(204);
  const projectId = objectProject("widget", widgetId);
  if (!projectId) return empty(204);
  const page = pageOf(body.u) || pageOf(`${originOf(req.headers.get("origin"))}/`);
  recordEvent({ projectId, type: "widget", id: widgetId, metric: WIDGET_KIND[body.k], dim: page, ip: clientIpFrom(req.headers), ua: ua(req) });
  return empty(204);
}

/** POST /api/collect: the wall and step-by-step form beacons (WALL-05, FORM-15). */
export async function pageBeaconResponse(req: Request): Promise<Response> {
  const stop = gate(req);
  if (stop) return stop;
  const body = await parseBody(req, pageBeacon);
  if (body === "too-large") return empty(413);
  if (!body) return empty(204);
  const projectId = objectProject(body.t, body.id);
  if (!projectId) return empty(204);
  const dim = body.t === "form" && body.k === "step" ? String(body.s ?? 0) : "";
  recordEvent({ projectId, type: body.t, id: body.id, metric: body.k, dim, ip: clientIpFrom(req.headers), ua: ua(req) });
  return empty(204);
}
