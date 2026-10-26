import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as wizardRoute } from "@/app/api/admin/onboarding/route";
import { POST as importRoute } from "@/app/api/admin/onboarding/import/route";
import { PATCH as checklistRoute } from "@/app/api/admin/projects/[id]/checklist/route";
import { getDb, schema } from "@/db";
import { getDefaultForm } from "@/lib/forms";
import { parseFormRow } from "@/lib/forms/schema";
import { brandFromHtml, discoverFromHtml, robotsAllows } from "@/lib/importers/sources/website";
import { runDueJobs } from "@/lib/jobs";
import { getPrefs } from "@/lib/notifications/prefs";
import { checklistState, createStarterAssets, discover, getWelcome, parseOnboarding } from "@/lib/onboarding";
import { parseBrand } from "@/lib/projects";
import { createProject, createTestimonial, getProjectById, listTestimonials } from "@/lib/testimonials";
import { getWall } from "@/lib/walls";
import { listWidgets, updateWidget, widgetConfig } from "@/lib/widgets";
import { registerJobs } from "@/lib/worker";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

const SITE = path.resolve(__dirname, "fixtures/onboarding/site");
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

/** A stand-in for the owner's site: the fixture, plus a site whose robots.txt says no and an oversized page. */
let server: http.Server;
let origin = "";
let robots = "User-agent: *\nAllow: /\n";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/robots.txt") return res.writeHead(200, { "content-type": "text/plain" }).end(robots);
    if (url.pathname === "/huge/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<html><body>${"x".repeat(6 * 1024 * 1024)}</body></html>`);
    }
    if (url.pathname === "/site/" || url.pathname === "/site/index.html") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    if (url.pathname === "/site/logo.png") return res.writeHead(200, { "content-type": "image/png" }).end(fs.readFileSync(path.join(SITE, "logo.png")));
    res.writeHead(404).end("not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  robots = "User-agent: *\nAllow: /\n";
  process.env.NET_GUARD_ALLOW = new URL(origin).host;
});
afterEach(() => {
  delete process.env.NET_GUARD_ALLOW;
  ctx.cleanup();
});

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "PATCH", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) });

describe("finding testimonials on the owner's site", () => {
  it("ONB-03 finds JSON-LD reviews, figures, cards and attributed blockquotes, but not pull quotes or the footer", () => {
    const found = discoverFromHtml(html, "https://larkspur.example/");
    expect(found.map((f) => f.authorName)).toEqual(["Grace Hopper", "Ada Lovelace", "Katherine Johnson", "Alan Turing"]);
    const ada = found.find((f) => f.authorName === "Ada Lovelace")!;
    expect(ada.text).toBe("Their cinnamon buns turned our office meeting into the highlight of the week.");
    expect(ada).toMatchObject({ authorTitle: "Office manager", authorCompany: "Engines Ltd" });
    const kj = found.find((f) => f.authorName === "Katherine Johnson")!;
    expect(kj).toMatchObject({ authorTitle: "Analyst", authorCompany: "Langley Labs", rating: 4 });
    expect(kj.text).toBe("Lovely staff, and the rye loaf keeps fresh for days. We order every week now.");
    expect(found.find((f) => f.authorName === "Grace Hopper")!.rating).toBe(5);
    expect(JSON.stringify(found)).not.toMatch(/good bread takes time|Bake well/);
    // Reading the same page twice gives the same ids (dedupe on re-import).
    expect(discoverFromHtml(html).map((f) => f.sourceReviewId)).toEqual(found.map((f) => f.sourceReviewId));
  });

  it("ONB-03 reads the brand: site name, theme colour and a non-SVG logo", () => {
    expect(brandFromHtml(html, "https://larkspur.example/home/")).toEqual({
      name: "Larkspur Bakery",
      color: "#2f6b4f",
      logoUrl: "https://larkspur.example/home/logo.png",
    });
    expect(brandFromHtml('<link rel="apple-touch-icon" href="/i.svg"><meta name="theme-color" content="red">', "https://a.example/").logoUrl).toBeUndefined();
    expect(brandFromHtml('<meta name="theme-color" content="red">', "https://a.example/").color).toBeUndefined();
  });

  it("ONB-03 respects robots.txt", async () => {
    expect(robotsAllows("User-agent: *\nDisallow: /", "/")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /private\n", "/")).toBe(true);
    expect(robotsAllows("User-agent: Plaudit\nDisallow: /\n\nUser-agent: *\nAllow: /", "/")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /\nAllow: /$", "/")).toBe(true);
    expect(robotsAllows("", "/")).toBe(true);
    robots = "User-agent: *\nDisallow: /\n";
    const p = createProject({ name: "Bakery", slug: "bakery" });
    const d = await discover(p.id, `${origin}/site/`);
    expect(d.error).toMatch(/robots\.txt/);
    expect(d.runId).toBeNull();
  });

  it("ONB-03 refuses pages over 5 MB and private addresses", async () => {
    const p = createProject({ name: "Bakery", slug: "bakery" });
    expect((await discover(p.id, `${origin}/huge/`)).error).toMatch(/larger than 5 MB/);
    delete process.env.NET_GUARD_ALLOW;
    expect((await discover(p.id, `${origin}/site/`)).error).toMatch(/private address/);
    expect((await discover(p.id, "http://169.254.169.254/latest/meta-data/")).error).toMatch(/private address/);
    expect((await discover(p.id, "ftp://example.com/")).error).toBeTruthy();
  });
});

describe("the wizard", () => {
  it("ONB-01 makes the project from the answers, imports the chosen finds as approved and ticks the email box", async () => {
    const res = await wizardRoute(post("/api/admin/onboarding", { name: "Larkspur Bakery", website: `${origin}/site/`, businessType: "local", emailMe: true }));
    expect(res.status).toBe(201);
    const { project, discovery } = (await res.json()) as { project: { id: string; slug: string }; discovery: { runId: string; items: { id: string; authorName: string }[] } };
    expect(project.slug).toBe("larkspur-bakery");
    const row = getProjectById(project.id)!;
    expect(row).toMatchObject({ website: `${origin}/site/`, businessType: "local" });
    expect(parseOnboarding(row.onboarding).answers).toEqual({ businessType: "local", website: `${origin}/site/` });
    expect(parseBrand(row.brand).colors.primary).toBe("#2f6b4f");
    expect(row.logoKey).toMatch(/^images\/.+\.png$/);
    expect(discovery.items).toHaveLength(4);
    expect(getPrefs(ADMIN_EMAIL).newTestimonial).toBe("instant");
    expect(getWelcome(ADMIN_EMAIL)).toBe("done");

    const imp = await importRoute(post("/api/admin/onboarding/import", { projectId: project.id, runId: discovery.runId, selection: "all" }));
    expect(imp.status).toBe(200);
    await runDueJobs();
    const rows = listTestimonials(project.id);
    expect(rows).toHaveLength(4);
    expect(rows.every((t) => t.status === "approved" && t.platform === "website" && t.source === "importer:website")).toBe(true);
    const c = checklistState(project.id);
    expect(c.doneCount).toBe(1);
    expect(c.steps.find((s) => s.id === "collect")!.done).toBe(true);
    // A second wizard with the same name gets its own link.
    const again = await wizardRoute(post("/api/admin/onboarding", { name: "Larkspur Bakery", businessType: "other" }));
    expect(((await again.json()) as { project: { slug: string } }).project.slug).toBe("larkspur-bakery-2");
  });

  it("ONB-01 a site that can't be read still makes the project, and skipping hides the card", async () => {
    const res = await wizardRoute(post("/api/admin/onboarding", { name: "No Site", website: `${origin}/missing/`, businessType: "saas" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { discovery: { error: string; items: unknown[] } };
    expect(body.discovery.error).toMatch(/404/);
    expect(body.discovery.items).toEqual([]);
    expect(getPrefs(ADMIN_EMAIL).newTestimonial).toBe("off");
    const skip = await wizardRoute(post("/api/admin/onboarding", { skip: true }));
    expect(skip.status).toBe(200);
    expect(getWelcome(ADMIN_EMAIL)).toBe("skipped");
    const bad = await wizardRoute(post("/api/admin/onboarding", { name: "" }));
    expect(bad.status).toBe(400);
  });
});

describe("starter assets and the checklist", () => {
  it("ONB-04 creates a branded step-by-step default form, a published main wall and grid and carousel widgets, once", () => {
    const p = createProject({ name: "Acme", slug: "acme" });
    const { form, wall, widgets } = createStarterAssets(p, { businessType: "saas", color: "#123456" });
    expect(form.isDefault).toBe(true);
    expect(form.layout).toBe("steps");
    const cfg = parseFormRow(form);
    expect(cfg.design).toMatchObject({ primary: "#123456", button: "#123456", showLogo: true });
    expect(getDefaultForm(p.id).id).toBe(form.id);
    expect(getWall(wall.id)).toMatchObject({ published: true, isMain: true });
    expect(widgets.map((w) => w.layout)).toEqual(["grid", "carousel"]);
    expect(widgets.every((w) => widgetConfig(w).design.accent === "#123456")).toBe(true);
    expect(parseBrand(getProjectById(p.id)!.brand).colors.primary).toBe("#123456");
    createStarterAssets(getProjectById(p.id)!, { businessType: "saas", color: "#123456" });
    expect(listWidgets(p.id)).toHaveLength(2);
    expect(getDb().select().from(schema.walls).all()).toHaveLength(1);
  });

  it("ONB-05 checklist: live steps, the manual install tick, skips, and dismissing only when finished", async () => {
    const p = createProject({ name: "Acme", slug: "acme" });
    const { widgets } = createStarterAssets(p, { businessType: "other" });
    const state = () => checklistState(p.id);
    expect(state()).toMatchObject({ doneCount: 0, complete: false, dismissed: false, shown: true });

    createTestimonial(p.id, { name: "Ada", text: "Great" });
    expect(state().steps.find((s) => s.id === "collect")!.done).toBe(true);

    // Starter widgets don't count until they're changed.
    expect(state().steps.find((s) => s.id === "widget")!.done).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    updateWidget(widgets[0].id, { name: "Homepage grid" });
    expect(state().steps.find((s) => s.id === "widget")!.done).toBe(true);

    const url = `/api/admin/projects/${p.id}/checklist`;
    const early = await checklistRoute(patch(url, { dismiss: true }), params({ id: p.id }));
    expect(early.status).toBe(409);
    await checklistRoute(patch(url, { step: "install", action: "done" }), params({ id: p.id }));
    expect(state().steps.find((s) => s.id === "install")!.done).toBe(true);
    await checklistRoute(patch(url, { step: "share", action: "skip" }), params({ id: p.id }));
    expect(state()).toMatchObject({ complete: true, doneCount: 3 });
    expect(state().steps.find((s) => s.id === "share")).toMatchObject({ done: false, skipped: true });
    const undo = await checklistRoute(patch(url, { step: "share", action: "undo" }), params({ id: p.id }));
    expect(((await undo.json()) as { checklist: { complete: boolean } }).checklist.complete).toBe(false);
    await checklistRoute(patch(url, { step: "share", action: "done" }), params({ id: p.id }));
    const done = await checklistRoute(patch(url, { dismiss: true }), params({ id: p.id }));
    expect(done.status).toBe(200);
    expect(state()).toMatchObject({ dismissed: true, shown: false });
  });

  it("ONB-05 projects made without the wizard show no checklist", () => {
    const p = createProject({ name: "Plain", slug: "plain" });
    expect(checklistState(p.id).shown).toBe(false);
  });
});
