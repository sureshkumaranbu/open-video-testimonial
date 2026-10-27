import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as objectRoute } from "@/app/api/admin/analytics/[type]/[id]/route";
import { GET as dashboardRoute } from "@/app/api/admin/analytics/route";
import { POST as dismissRoute } from "@/app/api/admin/widgets/[id]/dismiss-alert/route";
import { POST as collectRoute } from "@/app/api/collect/route";
import { POST as legacySubmit } from "@/app/api/projects/[slug]/testimonials/route";
import { POST as formSubmit } from "@/app/api/projects/[slug]/forms/[form]/submissions/route";
import { GET as snippetRoute } from "@/app/schema/[file]/route";
import { POST as seenRoute } from "@/app/api/widget/[slug]/seen/route";
import { getDb, schema } from "@/db";
import {
  aggregateRaw,
  BEACONS_PER_WINDOW,
  capDims,
  dashboardReport,
  DAILY_EVENT_CAP,
  DIMS_PER_DAY,
  installStatus,
  objectReport,
  OTHER_DIM,
  pageOf,
  parseRange,
  previousPeriod,
  purgeOld,
  removedAlerts,
  resetCollectState,
  rollupDays,
  runAnalyticsTask,
  utcDay,
  VISITOR_DAY_CAP,
  type TotalRow,
} from "@/lib/analytics";
import { createForm, getDefaultForm, updateForm } from "@/lib/forms";
import { pageEnabled } from "@/lib/forms/engine";
import { parseFormRow } from "@/lib/forms/schema";
import { runDueJobs } from "@/lib/jobs";
import { recordSignIn } from "@/lib/members";
import { setPrefs } from "@/lib/notifications";
import { createSnippet } from "@/lib/seo-snippets";
import { createProject, createTestimonial, getProjectById } from "@/lib/testimonials";
import { createWall, updateWall } from "@/lib/walls";
import { createWebhook } from "@/lib/webhook-admin";
import { DEFAULT_EVENTS, subscribers } from "@/lib/webhooks";
import { createWidget, deleteWidget, getWidget } from "@/lib/widgets";
import { registerJobs } from "@/lib/worker";
import { ADMIN_EMAIL, adminHeaders, formSubmission, params, submissionForm, submitFormRequest, submitRequest, useTempDataDir } from "./helpers";
import { simpleParser } from "./mail-parse";

const { analyticsEvents, analyticsDaily, analyticsSalts, analyticsRollups, webhookDeliveries } = schema;
const DAY = 86_400_000;
const UA = "Mozilla/5.0 (Macintosh) Safari/605.1.15";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetCollectState();
  registerJobs();
  process.env.PUBLIC_URL = "https://plaudit.example";
  process.env.MAIL_OUTBOX = "true";
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.ANALYTICS;
  delete process.env.PUBLIC_URL;
  delete process.env.MAIL_OUTBOX;
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

/** A beacon as a browser sends it: text/plain, no custom headers. */
function beacon(url: string, body: unknown, o: { ip?: string; ua?: string; origin?: string } = {}) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "x-forwarded-for": o.ip ?? "203.0.113.10",
      "user-agent": o.ua ?? UA,
      ...(o.origin ? { origin: o.origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const seen = (id: string, body: unknown, o: Parameters<typeof beacon>[2] = {}) => seenRoute(beacon(`/api/widget/${id}/seen`, body, o), params({ slug: id }));
const collect = (body: unknown, o: Parameters<typeof beacon>[2] = {}) => collectRoute(beacon("/api/collect", body, o));
const events = () => getDb().select().from(analyticsEvents).all();
const range = (from: string, to: string) => parseRange(from, to, new Date(`${to}T12:00:00Z`));

/** Raw events written straight to the table, dated in the past (the collector always dates them "now"). */
function seedEvents(rows: { type?: "widget" | "form" | "wall" | "snippet"; id: string; metric: string; dim?: string; visitor: string; at: Date }[]) {
  const values = rows.map((r) => ({ projectId, objectType: r.type ?? "widget", objectId: r.id, metric: r.metric as "view", dim: r.dim ?? "", visitor: r.visitor, day: utcDay(r.at), at: r.at }));
  getDb().transaction((tx) => {
    for (let i = 0; i < values.length; i += 1000) tx.insert(analyticsEvents).values(values.slice(i, i + 1000)).run();
  });
}

describe("collection (DISP-14, privacy)", () => {
  it("DISP-14 a widget beacon stores the page without its query or fragment, and never the address or user agent", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    const res = await seen(w.id, { k: "view", u: "https://Example.com/pricing?email=ada@example.com#top" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const [e] = events();
    expect(e).toMatchObject({ projectId, objectType: "widget", objectId: w.id, metric: "view", dim: "https://example.com/pricing", day: utcDay() });
    expect(e.visitor).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Nothing anywhere in the file holds the address, the user agent or the query.
    getDb().run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    const file = fs.readFileSync(path.join(ctx.dir, "plaudit.db")).toString("latin1");
    for (const secret of ["203.0.113.10", "Macintosh", "ada@example.com", "email="]) expect(file).not.toContain(secret);
    expect(pageOf("javascript:alert(1)")).toBe("");
    expect(pageOf("https://example.com")).toBe("https://example.com/");
  });

  it("DISP-14 clicks arrive by kind: read more, source link, CTA (and the badge), video play", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    for (const k of ["rm", "src", "b", "bd", "play", "more", "cta"]) expect((await seen(w.id, { k, u: "https://example.com/" })).status).toBe(204);
    expect(events().map((e) => e.metric)).toEqual(["more", "source", "cta", "cta", "play", "more", "cta"]);
  });

  it("DISP-14 unknown and deleted widgets, project slugs and bodies that aren't ours are ignored, and nothing is echoed", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    deleteWidget(w.id);
    const answers = [
      await seen("w_aaaaaaaaaaaa", { k: "view" }),
      await seen(w.id, { k: "view" }),
      await seen("acme", { k: "view" }),
      await seen(createWidget(projectId, { name: "Live", layout: "list" }).id, "<script>alert(1)</script>"),
      await seen(createWidget(projectId, { name: "Live 2", layout: "list" }).id, { k: "hover", u: "https://example.com/" }),
      await collect({ t: "wall", id: "nope", k: "view" }),
      await collect({ t: "form", id: getDefaultForm(projectId).id, k: "complete" }),
    ];
    for (const r of answers) {
      expect(r.status).toBe(204);
      expect(await r.text()).toBe("");
    }
    expect(events()).toHaveLength(0);
  });

  it("DISP-14 a body over 2 KB is refused without reading on, and each address is rate-limited", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    expect((await seen(w.id, { k: "view", u: `https://example.com/${"a".repeat(3000)}` })).status).toBe(413);
    for (let i = 0; i < BEACONS_PER_WINDOW; i++) await seen(w.id, { k: "view", u: "https://example.com/" }, { ip: "198.51.100.1" });
    expect((await seen(w.id, { k: "view" }, { ip: "198.51.100.1" })).status).toBe(429);
    expect((await seen(w.id, { k: "view" }, { ip: "198.51.100.2" })).status).toBe(204);
    expect(events()).toHaveLength(BEACONS_PER_WINDOW + 1);
  });

  it("DISP-14 crawlers aren't visitors, and ANALYTICS=off stores nothing at all", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    await seen(w.id, { k: "view" }, { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    expect(events()).toHaveLength(0);
    process.env.ANALYTICS = "off";
    expect((await seen(w.id, { k: "view", u: "https://example.com/" })).status).toBe(204);
    expect((await collect({ t: "form", id: getDefaultForm(projectId).id, k: "view" })).status).toBe(204);
    expect(events()).toHaveLength(0);
    expect(getDb().select().from(analyticsSalts).all()).toHaveLength(0);
    const off = await dashboardRoute(new Request("http://localhost/api/admin/analytics", { headers: adminHeaders() }));
    expect(off.status).toBe(404);
  });

  it("DISP-14 the visitor id changes every day, and salts are deleted after two days", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    const { recordEvent } = await import("@/lib/analytics");
    const day1 = new Date("2026-10-01T10:00:00Z");
    const day2 = new Date("2026-10-02T10:00:00Z");
    const one = { projectId, type: "widget" as const, id: w.id, metric: "view" as const, ip: "203.0.113.5", ua: UA };
    recordEvent({ ...one, now: day1 });
    recordEvent({ ...one, now: day1 });
    recordEvent({ ...one, now: day2 });
    recordEvent({ ...one, projectId: createProject({ name: "Other", slug: "other" }).id, now: day2 });
    const v = events().map((e) => e.visitor);
    expect(v[0]).toBe(v[1]);
    expect(v[2]).not.toBe(v[0]);
    // The same person on another project's widget is another visitor too.
    expect(v[3]).not.toBe(v[2]);
    expect(getDb().select().from(analyticsSalts).all().map((s) => s.day)).toEqual(["2026-10-01", "2026-10-02"]);
    purgeOld(new Date("2026-10-03T01:00:00Z"));
    expect(getDb().select().from(analyticsSalts).all().map((s) => s.day)).toEqual(["2026-10-02"]);
    purgeOld(new Date("2026-10-04T01:00:00Z"));
    expect(getDb().select().from(analyticsSalts).all()).toHaveLength(0);
  });

  it("DISP-14 past the daily cap an object's events are counted as dropped, not stored", async () => {
    const w = createWidget(projectId, { name: "Busy", layout: "grid" });
    const now = new Date();
    seedEvents(Array.from({ length: DAILY_EVENT_CAP }, (_, i) => ({ id: w.id, metric: "view", visitor: `v${i % 5000}`, at: now })));
    await seen(w.id, { k: "view", u: "https://example.com/" });
    await seen(w.id, { k: "cta", u: "https://example.com/" });
    expect(events()).toHaveLength(DAILY_EVENT_CAP);
    const report = objectReport("widget", w.id, projectId, parseRange(null, null));
    expect(report.current.dropped).toBe(2);
  });
});

describe("rollup and retention (DISP-14)", () => {
  it("DISP-14 one visitor counts at most 50 times a day per metric, and a day keeps its 100 busiest pages", () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    const at = new Date("2026-10-01T09:00:00Z");
    seedEvents([
      ...Array.from({ length: 500 }, () => ({ id: w.id, metric: "view", dim: "https://example.com/", visitor: "loop", at })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: w.id, metric: "view", dim: "https://example.com/", visitor: `p${i}`, at })),
    ]);
    const rows = aggregateRaw(["2026-10-01"], { dims: true });
    const total = rows.find((r) => r.objectId === w.id && r.metric === "view" && r.dim === "")!;
    expect(total).toMatchObject({ count: VISITOR_DAY_CAP + 3, uniques: 4 });
    const many: TotalRow[] = Array.from({ length: DIMS_PER_DAY + 20 }, (_, i) => ({ projectId, objectType: "widget", objectId: w.id, day: "2026-10-01", metric: "view", dim: `https://example.com/p${i}`, count: 200 - i, uniques: 1 }));
    const capped = capDims(many);
    expect(capped).toHaveLength(DIMS_PER_DAY + 1);
    expect(capped.at(-1)).toMatchObject({ dim: OTHER_DIM, count: many.slice(DIMS_PER_DAY).reduce((n, r) => n + r.count, 0) });
  });

  it("DISP-14 finished days are rolled up once; raw events go after 30 days and the totals stay, with no 30-day limit", () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    const old = new Date("2025-06-15T12:00:00Z");
    const recent = new Date("2026-10-20T12:00:00Z");
    seedEvents([
      { id: w.id, metric: "view", dim: "https://example.com/", visitor: "a", at: old },
      { id: w.id, metric: "view", dim: "https://example.com/", visitor: "b", at: old },
      { id: w.id, metric: "cta", dim: "https://example.com/", visitor: "a", at: old },
      { id: w.id, metric: "view", dim: "https://example.com/pricing", visitor: "c", at: recent },
    ]);
    // A 500-day-old day is rolled when the job ran back then.
    expect(rollupDays(new Date("2025-06-16T01:00:00Z"))).toContain("2025-06-15");
    expect(rollupDays(new Date("2025-06-16T02:00:00Z"))).toEqual([]);
    const now = new Date("2026-10-27T12:00:00Z");
    const out = runAnalyticsTask(now);
    expect(out.rolled).toContain("2026-10-20");
    expect(out.purged.events).toBe(3);
    expect(events()).toHaveLength(1);
    const daily = getDb().select().from(analyticsDaily).all();
    expect(daily.find((r) => r.day === "2025-06-15" && r.objectId === w.id && r.metric === "view" && r.dim === "")).toMatchObject({ count: 2, uniques: 2 });
    // The project's total for widgets, and the page.
    expect(daily.find((r) => r.day === "2025-06-15" && r.objectId === "" && r.metric === "view")).toMatchObject({ count: 2, uniques: 2 });
    expect(daily.find((r) => r.day === "2025-06-15" && r.dim === "https://example.com/")).toMatchObject({ count: 2 });
    expect(getDb().select().from(analyticsRollups).all().length).toBeGreaterThan(1);
    // A range of more than a year reads the kept totals.
    const report = objectReport("widget", w.id, projectId, parseRange("2025-06-01", "2026-10-27", now), now);
    expect(report.current).toMatchObject({ views: 3, visitors: 3, clicks: { cta: 1 } });
  });

  it("DISP-14 a widget report: views, visitors, clicks by kind, top pages and the previous period", () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    const now = new Date("2026-10-27T12:00:00Z");
    const at = (d: string) => new Date(`${d}T10:00:00Z`);
    seedEvents([
      // This period (21–27 Oct): today's raw events plus rolled days.
      { id: w.id, metric: "view", dim: "https://example.com/pricing", visitor: "a", at: at("2026-10-27") },
      { id: w.id, metric: "view", dim: "https://example.com/pricing", visitor: "a", at: at("2026-10-27") },
      { id: w.id, metric: "view", dim: "https://example.com/", visitor: "b", at: at("2026-10-27") },
      { id: w.id, metric: "more", dim: "https://example.com/", visitor: "b", at: at("2026-10-27") },
      { id: w.id, metric: "view", dim: "https://example.com/pricing", visitor: "a", at: at("2026-10-22") },
      { id: w.id, metric: "source", dim: "https://example.com/pricing", visitor: "a", at: at("2026-10-22") },
      { id: w.id, metric: "play", dim: "https://example.com/pricing", visitor: "a", at: at("2026-10-22") },
      // The previous period (14–20 Oct).
      { id: w.id, metric: "view", dim: "https://example.com/", visitor: "z", at: at("2026-10-15") },
    ]);
    rollupDays(now);
    const p = range("2026-10-21", "2026-10-27");
    expect(previousPeriod(p)).toMatchObject({ from: "2026-10-14", to: "2026-10-20" });
    const r = objectReport("widget", w.id, projectId, p, now);
    // a counts once on the 27th and again on the 22nd: visitors are per day.
    expect(r.current).toMatchObject({ views: 4, visitors: 3, clicks: { more: 1, source: 1, cta: 0, play: 1 } });
    expect(r.previous).toMatchObject({ views: 1, visitors: 1 });
    expect(r.topPages.map((x) => [x.dim, x.count])).toEqual([
      ["https://example.com/pricing", 3],
      ["https://example.com/", 1],
    ]);
    expect(r.series.views).toEqual([0, 1, 0, 0, 0, 0, 3]);
    expect(r.series.previousViews).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });

  it("DISP-14 the admin route answers for one widget and refuses other projects' ids and types it doesn't know", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    await seen(w.id, { k: "view", u: "https://example.com/" });
    const get = (type: string, id: string) => objectRoute(new Request(`http://localhost/api/admin/analytics/${type}/${id}`, { headers: adminHeaders() }), params({ type, id }));
    const res = await get("widget", w.id);
    expect(res.status).toBe(200);
    expect((await res.json()).report.current.views).toBe(1);
    expect((await get("widget", "w_zzzzzzzzzzzz")).status).toBe(404);
    expect((await get("project", projectId)).status).toBe(404);
    expect((await objectRoute(new Request(`http://localhost/api/admin/analytics/widget/${w.id}`), params({ type: "widget", id: w.id }))).status).toBe(401);
  });
});

describe("install detection (DISP-13)", () => {
  it("DISP-13 shows where a widget is live, fires widget.installed once, and reports it removed after 7 days without a view", async () => {
    const w = createWidget(projectId, { name: "Pricing wall", layout: "grid" });
    const hook = createWebhook({ url: "https://hooks.example/w", events: ["widget.installed", "widget.removed"], projectId: null, formId: null, active: true });
    createWebhook({ url: "https://hooks.example/all", events: [], projectId: null, formId: null, active: true });
    recordSignIn(ADMIN_EMAIL);
    setPrefs(ADMIN_EMAIL, { widgetRemoved: true });
    expect(installStatus(getWidget(w.id)!).state).toBe("never");

    const t0 = new Date("2026-10-01T09:00:00Z");
    seedEvents([
      { id: w.id, metric: "view", dim: "https://example.com/pricing", visitor: "a", at: t0 },
      // The hosted link on this server itself is never an install.
      { id: w.id, metric: "view", dim: "https://plaudit.example/embed/" + w.id, visitor: "a", at: new Date(t0.getTime() + 1000) },
    ]);
    runAnalyticsTask(new Date(t0.getTime() + 3_600_000));
    const live = getWidget(w.id)!;
    expect(live).toMatchObject({ lastSeenOrigin: "https://example.com", lastSeenPath: "/pricing", removedAt: null });
    const status = installStatus(live, new Date(t0.getTime() + 3_600_000));
    expect(status).toMatchObject({ state: "live", lastSeenPage: "https://example.com/pricing", hostedViews: 1 });
    expect(status.pages.map((p) => p.page)).toEqual(["https://example.com/pricing"]);
    // Running again sends nothing new.
    runAnalyticsTask(new Date(t0.getTime() + 2 * 3_600_000));
    const deliveries = () => getDb().select().from(webhookDeliveries).all();
    expect(deliveries().map((d) => d.event)).toEqual(["widget.installed"]);
    expect(deliveries()[0].webhookId).toBe(hook.id);
    expect(JSON.parse(deliveries()[0].payload).data).toMatchObject({ widget: { id: w.id, name: "Pricing wall" }, page: { url: "https://example.com/pricing", origin: "https://example.com", path: "/pricing" } });

    // Six days later it's still live; after seven it's removed.
    expect(runAnalyticsTask(new Date(t0.getTime() + 6 * DAY)).removed).toBe(0);
    expect(runAnalyticsTask(new Date(t0.getTime() + 7 * DAY + 3_600_000)).removed).toBe(1);
    expect(installStatus(getWidget(w.id)!, new Date(t0.getTime() + 8 * DAY)).state).toBe("removed");
    expect(removedAlerts([projectId]).map((a) => [a.widgetId, a.page])).toEqual([[w.id, "https://example.com/pricing"]]);
    expect(deliveries().map((d) => d.event)).toEqual(["widget.installed", "widget.removed"]);
    // Only the hook that selected them: these events are opt-in (D7).
    expect(DEFAULT_EVENTS).not.toContain("widget.installed");
    expect(DEFAULT_EVENTS).not.toContain("widget.removed");
    expect(subscribers("widget.removed", projectId).map((h) => h.id)).toEqual([hook.id]);
    await runDueJobs({ now: () => new Date(Date.now() + DAY) });
    const dir = path.join(ctx.dir, "mail-outbox");
    const mails = await Promise.all(fs.readdirSync(dir).map((f) => simpleParser(fs.readFileSync(path.join(dir, f), "utf8"))));
    const mail = mails.find((m) => /seems to be off your site/.test(m.subject ?? ""));
    expect(mail?.headers.to).toContain(ADMIN_EMAIL);
    expect(mail?.text).toContain("https://example.com/pricing");

    // The in-app alert can be hidden; a view brings the widget back (and fires installed again).
    const dismissed = await dismissRoute(new Request(`http://localhost/api/admin/widgets/${w.id}/dismiss-alert`, { method: "POST", headers: adminHeaders() }), params({ id: w.id }));
    expect(dismissed.status).toBe(200);
    expect(removedAlerts([projectId])).toEqual([]);
    const back = new Date(t0.getTime() + 9 * DAY);
    seedEvents([{ id: w.id, metric: "view", dim: "https://example.com/pricing", visitor: "q", at: back }]);
    runAnalyticsTask(new Date(back.getTime() + 60_000));
    expect(getWidget(w.id)).toMatchObject({ removedAt: null, removedDismissed: false });
    expect(deliveries().map((d) => d.event)).toEqual(["widget.installed", "widget.removed", "widget.installed"]);
  });

  it("DISP-13 a widget that was never live, or was deleted, is never reported removed", () => {
    const never = createWidget(projectId, { name: "Never", layout: "grid" });
    const gone = createWidget(projectId, { name: "Gone", layout: "grid" });
    seedEvents([{ id: gone.id, metric: "view", dim: "https://example.com/", visitor: "a", at: new Date("2026-10-01T09:00:00Z") }]);
    runAnalyticsTask(new Date("2026-10-01T10:00:00Z"));
    deleteWidget(gone.id);
    expect(runAnalyticsTask(new Date("2026-10-20T10:00:00Z")).removed).toBe(0);
    expect(getWidget(never.id)!.removedAt).toBeNull();
    expect(removedAlerts()).toEqual([]);
  });
});

describe("forms, walls and snippets", () => {
  it("FORM-15 a step-by-step form: views, visitors, starts, completions, completion %, average rating and per-page drop-off", async () => {
    const form = createForm(projectId, { name: "Stories", slug: "stories" });
    const cfg = parseFormRow(form);
    updateForm(form.id, { settings: { ...cfg.settings, lowRating: { ...cfg.settings.lowRating, enabled: true, threshold: 2 } } });
    const pages = cfg.pages.flatMap((p, i) => (p.type !== "thank_you" && pageEnabled(p) ? [i] : []));
    // Three visitors open it; two start; one goes to the end and sends it.
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      await collect({ t: "form", id: form.id, k: "view" }, { ip });
      await collect({ t: "form", id: form.id, k: "step", s: pages[0] }, { ip });
    }
    for (const ip of ["198.51.100.1", "198.51.100.2"]) {
      await collect({ t: "form", id: form.id, k: "start" }, { ip });
      await collect({ t: "form", id: form.id, k: "step", s: pages[1] }, { ip });
    }
    for (const s of pages.slice(2)) await collect({ t: "form", id: form.id, k: "step", s }, { ip: "198.51.100.1" });
    const sent = await formSubmit(
      submitFormRequest("acme", "stories", formSubmission({ rating: 4, answers: [{ key: "q1", text: "Lovely." }], person: { name: "Ada" }, consent: { agreed: true } }), "198.51.100.1"),
      params({ slug: "acme", form: "stories" }),
    );
    expect(sent.status).toBe(201);
    // A 1-star sent through the low-rating branch counts in the average too.
    const low = await formSubmit(
      submitFormRequest("acme", "stories", formSubmission({ rating: 1, lowFeedback: "Too slow.", person: {} }), "198.51.100.2"),
      params({ slug: "acme", form: "stories" }),
    );
    expect(low.status).toBe(201);
    const r = objectReport("form", form.id, projectId, parseRange(null, null));
    expect(r.current).toMatchObject({ views: 3, visitors: 3, starts: 2, completions: 2, completionRate: 66.7 });
    expect(r.funnel!.rating).toEqual({ average: 2.5, count: 2 });
    expect(r.funnel!.pages.slice(0, 3).map((p) => p.visitors)).toEqual([3, 2, 1]);
    expect(r.funnel!.pages[0].label).toMatch(/^1\. /);
    expect(r.funnel!.pages.at(-1)!.label).toMatch(/low ratings/);
  });

  it("FORM-15 the classic form counts its completions on the server (its views are counted as the page renders)", async () => {
    const res = await legacySubmit(submitRequest("acme", submissionForm({ name: "Ada", consent: "on", text: "Great." })), params({ slug: "acme" }));
    expect(res.status).toBe(201);
    const form = getDefaultForm(projectId);
    expect(events().map((e) => [e.objectType, e.objectId, e.metric])).toEqual([["form", form.id, "complete"]]);
    // The beacon route refuses "complete": only the server says a form was sent.
    await collect({ t: "form", id: form.id, k: "complete" });
    expect(events()).toHaveLength(1);
  });

  it("WALL-05 a published wall counts views, visitors, CTA clicks and link clicks; a draft counts nothing", async () => {
    const draft = createWall(getProjectById(projectId)!, { name: "Draft" });
    const wall = updateWall(createWall(getProjectById(projectId)!, { name: "Love" }).id, { published: true })!;
    await collect({ t: "wall", id: draft.id, k: "view" });
    for (const ip of ["198.51.100.1", "198.51.100.2"]) await collect({ t: "wall", id: wall.id, k: "view" }, { ip });
    await collect({ t: "wall", id: wall.id, k: "cta" });
    await collect({ t: "wall", id: wall.id, k: "link" });
    await collect({ t: "wall", id: wall.id, k: "link" });
    const r = objectReport("wall", wall.id, projectId, parseRange(null, null));
    expect(r.current).toMatchObject({ views: 2, visitors: 2, clicks: { cta: 1, link: 2 } });
    expect(events().some((e) => e.objectId === draft.id)).toBe(false);
  });

  it("SEO-04 every fetch of a dynamic snippet counts as a render, crawlers included, with the site it's on", async () => {
    const s = createSnippet(getProjectById(projectId)!, { name: "All" });
    const fetchIt = (ua: string, referer?: string) =>
      snippetRoute(new Request(`http://localhost/schema/${s.id}.js`, { headers: { "user-agent": ua, "x-forwarded-for": "203.0.113.4", ...(referer ? { referer } : {}) } }), params({ file: `${s.id}.js` }));
    expect((await fetchIt("Mozilla/5.0 (compatible; Googlebot/2.1)", "https://shop.example/product?id=9")).status).toBe(200);
    await fetchIt(UA, "https://shop.example/");
    await fetchIt(UA);
    await snippetRoute(new Request("http://localhost/schema/s_zzzzzzzzzzzz.js"), params({ file: "s_zzzzzzzzzzzz.js" }));
    const r = objectReport("snippet", s.id, projectId, parseRange(null, null));
    expect(r.current.renders).toBe(3);
    expect(r.sites.map((x) => [x.dim, x.count])).toEqual([["https://shop.example", 2]]);
  });
});

describe("dashboard (AN-01)", () => {
  it("AN-01 tiles: new testimonials by source, backlog, rating, widget, form and wall numbers, booster clicks, snippets and invites", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    const wall = updateWall(createWall(getProjectById(projectId)!, { name: "Love" }).id, { published: true })!;
    const form = getDefaultForm(projectId);
    createTestimonial(projectId, { name: "Ada", text: "Great", rating: 5 });
    createTestimonial(projectId, { name: "Bo", text: "Fine", rating: 3 }, { source: "import:csv" });
    await seen(w.id, { k: "view", u: "https://example.com/" });
    await seen(w.id, { k: "cta", u: "https://example.com/" });
    await collect({ t: "wall", id: wall.id, k: "view" });
    await collect({ t: "wall", id: wall.id, k: "cta" });
    await collect({ t: "form", id: form.id, k: "view" });
    await legacySubmit(submitRequest("acme", submissionForm({ name: "Cy", consent: "on", text: "Nice.", rating: "4" })), params({ slug: "acme" }));
    const res = await dashboardRoute(new Request(`http://localhost/api/admin/analytics?project=${projectId}`, { headers: adminHeaders() }));
    expect(res.status).toBe(200);
    const { report } = await res.json();
    expect(report.tiles.testimonials.current).toMatchObject({ total: 3, bySource: { form: 2, import: 1 } });
    expect(report.tiles.backlog.pending).toBe(3);
    expect(report.tiles.rating.current).toEqual({ average: 4, count: 3 });
    expect(report.tiles.widgets).toMatchObject({ views: 1, visitors: 1, clicks: 1 });
    expect(report.tiles.walls).toMatchObject({ views: 1, ctaClicks: 1 });
    expect(report.tiles.forms).toMatchObject({ views: 1, completions: 1, completionRate: 100 });
    expect(report.tiles.booster).toEqual({ current: 0, previous: 0 });
    expect(report.tiles.invites.current).toMatchObject({ sent: 0, opened: null });
    expect(report.tables.widgets[0]).toMatchObject({ id: w.id, views: 1, clicks: 1, ctr: 100 });
    expect(report.tables.walls[0]).toMatchObject({ id: wall.id, views: 1, ctaClicks: 1 });
    expect(report.previousRange.to < report.range.from).toBe(true);
    expect((await dashboardRoute(new Request("http://localhost/api/admin/analytics?project=nope", { headers: adminHeaders() }))).status).toBe(404);
    process.env.PLAUDIT_FEATURES = "widgets";
    expect((await dashboardRoute(new Request("http://localhost/api/admin/analytics", { headers: adminHeaders() }))).status).toBe(404);
  });

  it("AN-01 ranges: the last 30 days by default, never past today, at most two years, and garbage falls back", () => {
    const now = new Date("2026-10-27T15:00:00Z");
    expect(parseRange(null, null, now)).toMatchObject({ from: "2026-09-28", to: "2026-10-27" });
    expect(parseRange("2026-10-01", "2027-01-01", now)).toMatchObject({ from: "2026-10-01", to: "2026-10-27" });
    expect(parseRange("2026-10-20", "2026-10-10", now)).toMatchObject({ from: "2026-10-10", to: "2026-10-20" });
    expect(parseRange("2026-02-31", "x", now).to).toBe("2026-10-27");
    expect(parseRange("2010-01-01", "2026-10-27", now).days).toHaveLength(731);
  });

  it("AN-01 reads 100,000 of today's events fast (the live part of the dashboard)", () => {
    const widgetsList = Array.from({ length: 20 }, (_, i) => createWidget(projectId, { name: `W${i}`, layout: "grid" }));
    const now = new Date();
    const kinds = ["view", "view", "view", "more", "cta", "play"];
    seedEvents(
      Array.from({ length: 100_000 }, (_, i) => ({
        id: widgetsList[i % 20].id,
        metric: kinds[i % kinds.length],
        dim: `https://example.com/p${i % 40}`,
        visitor: `v${i % 30_000}`.padEnd(22, "x"),
        at: now,
      })),
    );
    const p = parseRange(null, null, now);
    dashboardReport([projectId], p, now); // warm the statement cache
    const started = performance.now();
    const report = dashboardReport([projectId], p, now);
    const ms = performance.now() - started;
    expect(report.tiles.widgets.views).toBe(50_001);
    console.log(`[AN-01] dashboard over 100k events: ${ms.toFixed(0)} ms`);
    expect(report.tables.widgets).toHaveLength(20);
    // 350 ms locally; CI machines get twice that.
    expect(ms).toBeLessThan(process.env.CI ? 700 : 350);
  }, 60_000);
});
