import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as wizardRoute } from "@/app/api/admin/onboarding/route";
import { GET as scanRoute, POST as rescanRoute } from "@/app/api/admin/onboarding/discover/route";
import { POST as importRoute } from "@/app/api/admin/onboarding/import/route";
import { PATCH as checklistRoute } from "@/app/api/admin/projects/[id]/checklist/route";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getDefaultForm } from "@/lib/forms";
import { parseFormRow } from "@/lib/forms/schema";
import { brandFromHtml, discoverFromHtml, robotsAllows } from "@/lib/importers/sources/website";
import { runDueJobs } from "@/lib/jobs";
import { getPrefs } from "@/lib/notifications/prefs";
import { BRAND_SCAN_JOB, checklistState, createStarterAssets, type Discovery, getDiscovery, getWelcome, parseOnboarding, setOnboardingFetch, startDiscovery } from "@/lib/onboarding";
import { fetchPublicText } from "@/lib/net-guard";
import { parseBrand } from "@/lib/projects";
import { createProject, createTestimonial, getProjectById, listTestimonials } from "@/lib/testimonials";
import { getWall, wallConfig } from "@/lib/walls";
import { listWidgets, updateWidget, widgetConfig } from "@/lib/widgets";
import { registerJobs } from "@/lib/worker";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

const SITE = path.resolve(__dirname, "fixtures/onboarding/site");
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
/** A page the heuristics get little from: no site name tag, no theme colour, a testimonial in plain paragraphs. */
const PLAIN = `<!doctype html><html><head><title>Home</title><style>.btn{background:#E0457B;color:#fff}body{color:#222222}</style></head><body>
<h1>Tamarind Tours</h1><p>Small-group food walks through the old town.</p>
<p>Sam Patel told us the evening walk was the best thing he did on his whole trip to the city.</p>
<a class="btn" href="/book">Book a walk</a></body></html>`;

/** Runs a brand scan of `url` through the job queue, as the dashboard would. */
async function scan(projectId: string, url: string): Promise<Discovery> {
  const run = startDiscovery(projectId, url);
  await runDueJobs();
  return getDiscovery(projectId, run.id)!.discovery!;
}

/** A stand-in OpenAI-compatible provider: answers what `answer` says and records what it was sent. */
let provider: http.Server;
let providerOrigin = "";
let answer: (body: { messages: { role: string; content: string }[] }) => { status?: number; body: unknown; delayMs?: number } = () => ({ body: {} });
const sent: { auth: string | undefined; body: { model: string; messages: { role: string; content: string }[] } }[] = [];
const chat = (content: unknown) => ({ body: { choices: [{ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }] } });

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
    if (url.pathname === "/plain/") return res.writeHead(200, { "content-type": "text/html" }).end(PLAIN);
    res.writeHead(404).end("not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  provider = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      sent.push({ auth: req.headers.authorization, body });
      const a = answer(body);
      setTimeout(() => {
        if (!res.destroyed) res.writeHead(a.status ?? 200, { "content-type": "application/json" }).end(typeof a.body === "string" ? a.body : JSON.stringify(a.body));
      }, a.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  providerOrigin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  provider.closeAllConnections();
  await new Promise<void>((r) => provider.close(() => r()));
});

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  robots = "User-agent: *\nAllow: /\n";
  process.env.NET_GUARD_ALLOW = new URL(origin).host;
});
afterEach(() => {
  delete process.env.NET_GUARD_ALLOW;
  delete process.env.BRAND_AI_API_URL;
  delete process.env.BRAND_AI_API_KEY;
  delete process.env.BRAND_AI_MODEL;
  delete process.env.AI_API_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  sent.length = 0;
  answer = () => ({ body: {} });
  setOnboardingFetch(null);
  vi.useRealTimers();
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

  it("ONB-03 finds a blockquote card whose name and role sit in plain lines after it, next to an avatar initial", () => {
    const card = (q: string, initial: string, who: string, role: string) =>
      `<article class="rounded-[14px] p-6"><blockquote class="font-[family-name:var(--font-serif)]">${q}</blockquote><div class="flex"><div aria-hidden="true">${initial}</div><div><p class="font-[family-name:var(--font-sans)]">${who}</p><p>${role}</p></div></div></article>`;
    // A whole section id="testimonials" holds both cards, and Tailwind classes contain "family-name".
    const page = `<html><body><section id="testimonials">${card("The study guides it made from my lectures saved my whole semester.", "R", "Riya Shah", "Law student")}${card("Transcripts arrive in minutes and I trust them enough to quote.", "T", "Tom Reed", "Journalist")}</section><blockquote>Good notes are half the work.</blockquote><div><p>We think every lecture deserves a second listen, so we built this.</p></div></body></html>`;
    const found = discoverFromHtml(page);
    expect(found.map((f) => [f.authorName, f.authorTitle])).toEqual([["Riya Shah", "Law student"], ["Tom Reed", "Journalist"]]);
    expect(found[0].text).toBe("The study guides it made from my lectures saved my whole semester.");
    // Scripts without capital letters (Tamil, Devanagari) still read as names.
    const tamil = discoverFromHtml(`<html><body>${card("Every lecture is now searchable, which changed how I revise.", "சு", "சுரேஷ் குமார்", "மாணவர்")}</body></html>`);
    expect(tamil.map((f) => [f.authorName, f.authorTitle])).toEqual([["சுரேஷ் குமார்", "மாணவர்"]]);
  });

  it("ONB-03 reads the brand: site name, theme colour and a non-SVG logo", () => {
    expect(brandFromHtml(html, "https://larkspur.example/home/")).toEqual({
      name: "Larkspur Bakery",
      color: "#2f6b4f",
      logoUrl: "https://larkspur.example/home/logo.png",
    });
    expect(brandFromHtml('<link rel="apple-touch-icon" href="/i.svg"><meta name="theme-color" content="red">', "https://a.example/").logoUrl).toBeUndefined();
    expect(brandFromHtml('<meta name="theme-color" content="red">', "https://a.example/").color).toBeUndefined();
    // Browser-bar colours (white, near-black, grey) aren't a brand colour: the default accent is kept.
    const bars = '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0f172a">';
    expect(brandFromHtml(bars, "https://a.example/").color).toBeUndefined();
    expect(brandFromHtml('<meta name="theme-color" content="#888888">', "https://a.example/").color).toBeUndefined();
    expect(brandFromHtml(`${bars}<meta name="theme-color" content="#E0457B">`, "https://a.example/").color).toBe("#e0457b");
  });

  it("ONB-03 respects robots.txt", async () => {
    expect(robotsAllows("User-agent: *\nDisallow: /", "/")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /private\n", "/")).toBe(true);
    expect(robotsAllows("User-agent: Plaudit\nDisallow: /\n\nUser-agent: *\nAllow: /", "/")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /\nAllow: /$", "/")).toBe(true);
    expect(robotsAllows("", "/")).toBe(true);
    robots = "User-agent: *\nDisallow: /\n";
    const p = createProject({ name: "Bakery", slug: "bakery" });
    const d = await scan(p.id, `${origin}/site/`);
    expect(d.error).toMatch(/robots\.txt/);
    expect(d.runId).toBeNull();
  });

  it("ONB-03 refuses pages over 5 MB and private addresses", async () => {
    const p = createProject({ name: "Bakery", slug: "bakery" });
    expect((await scan(p.id, `${origin}/huge/`)).error).toMatch(/larger than 5 MB/);
    delete process.env.NET_GUARD_ALLOW;
    expect((await scan(p.id, `${origin}/site/`)).error).toMatch(/private address/);
    expect((await scan(p.id, "http://169.254.169.254/latest/meta-data/")).error).toMatch(/private address/);
    expect((await scan(p.id, "ftp://example.com/")).error).toBeTruthy();
  });
});

describe("the brand scan (L10)", () => {
  const useProvider = (model = "brand-test-model") => {
    process.env.BRAND_AI_API_URL = `${providerOrigin}/v1`;
    process.env.BRAND_AI_API_KEY = "sk-test-brand";
    if (model) process.env.BRAND_AI_MODEL = model;
  };

  it("ONB-02 L10 runs as a background job and puts the colour, logo and site name on the project and its starter assets, even after the wizard moved on", async () => {
    const res = await wizardRoute(post("/api/admin/onboarding", { name: "Larkspur", website: `${origin}/site/`, businessType: "local" }));
    const { project, scan: run } = (await res.json()) as { project: { id: string }; scan: { id: string } };
    // The wizard answered before the site was read: the project and starters exist in the default look.
    const before = getProjectById(project.id)!;
    expect(parseBrand(before.brand).colors.primary).toBeUndefined();
    expect(before.logoKey).toBeNull();
    const { starter } = parseOnboarding(before.onboarding);
    expect(parseFormRow(getDefaultForm(project.id)).design.primary).toBeUndefined();
    const job = getDb().select().from(schema.jobs).where(eq(schema.jobs.type, BRAND_SCAN_JOB)).get()!;
    // L19: the job names its project, so its progress follows project access.
    expect(JSON.parse(job.payload)).toEqual({ projectId: project.id, runId: run.id });
    expect(getDiscovery(project.id, run.id)).toMatchObject({ run: { status: "queued", finished: false }, discovery: null });
    // Nobody is waiting on the wizard any more; the worker gets to it.
    const startedAt = Date.now();
    await runDueJobs();
    expect(Date.now() - startedAt).toBeLessThan(30_000);

    const after = getProjectById(project.id)!;
    expect(parseBrand(after.brand).colors).toMatchObject({ primary: "#2f6b4f", button: "#2f6b4f" });
    expect(after.logoKey).toMatch(/^images\/.+\.png$/);
    expect(parseOnboarding(after.onboarding).found).toMatchObject({ siteName: "Larkspur Bakery", color: "#2f6b4f", logo: true, ai: false });
    expect(parseFormRow(getDefaultForm(project.id)).design).toMatchObject({ primary: "#2f6b4f", button: "#2f6b4f" });
    const widgets = listWidgets(project.id);
    expect(widgets.every((w) => widgetConfig(w).design.accent === "#2f6b4f")).toBe(true);
    expect(wallConfig(getWall(starter!.wallId)!).heroCta.background).toBe("#2f6b4f");
    // Recolouring isn't the owner customising a widget.
    expect(checklistState(project.id).steps.find((s) => s.id === "widget")!.done).toBe(false);
    const done = getDiscovery(project.id, run.id)!;
    expect(done.run).toMatchObject({ status: "done", finished: true, percent: 100 });
    expect(done.discovery).toMatchObject({ brand: { name: "Larkspur Bakery", color: "#2f6b4f" }, error: null });
    expect(done.discovery!.items).toHaveLength(4);
  });

  it("ONB-02 L10 a colour the owner already chose stays, and scanning again replaces the earlier scan", async () => {
    const p = createProject({ name: "Bakery", slug: "bakery" });
    createStarterAssets(p, { businessType: "local", color: "#123456" });
    const first = startDiscovery(p.id, `${origin}/site/`);
    const res = await rescanRoute(post("/api/admin/onboarding/discover", { projectId: p.id, url: `${origin}/site/` }));
    expect(res.status).toBe(201);
    const { run } = (await res.json()) as { run: { id: string } };
    expect(getDiscovery(p.id, first.id)).toBeNull();
    await runDueJobs();
    expect(parseBrand(getProjectById(p.id)!.brand).colors.primary).toBe("#123456");
    expect(parseFormRow(getDefaultForm(p.id)).design.primary).toBe("#123456");
    expect(getDiscovery(p.id, run.id)!.discovery!.items).toHaveLength(4);
    // Another project's scan can't be read through this one.
    const other = createProject({ name: "Other", slug: "other" });
    const wrong = await scanRoute(new Request(`http://localhost/api/admin/onboarding/discover?projectId=${other.id}&runId=${run.id}`, { headers: adminHeaders() }));
    expect(wrong.status).toBe(404);
  });

  it("ONB-02 L10 a site that can't be read ends the scan quietly: the defaults stay and the job doesn't fail", async () => {
    const p = createProject({ name: "Bakery", slug: "bakery" });
    createStarterAssets(p, { businessType: "local" });
    const d = await scan(p.id, `${origin}/missing/`);
    expect(d).toMatchObject({ runId: null, items: [], brand: null });
    expect(d.error).toMatch(/404/);
    expect(parseBrand(getProjectById(p.id)!.brand).colors.primary).toBeUndefined();
    expect(getDb().select().from(schema.jobs).where(eq(schema.jobs.type, BRAND_SCAN_JOB)).get()!.status).toBe("done");
  });

  it("ONB-02 L10 every read waits 10 seconds at most, and the whole scan stops at 30 seconds", async () => {
    const p = createProject({ name: "Bakery", slug: "bakery" });
    const waits: { url: string; timeoutMs?: number }[] = [];
    // Only the clock is faked: each read "takes" 12 seconds of it.
    vi.useFakeTimers({ toFake: ["Date"] });
    setOnboardingFetch(async (url, o) => {
      waits.push({ url, timeoutMs: o?.timeoutMs });
      vi.setSystemTime(Date.now() + 12_000);
      return fetchPublicText(url, o);
    });
    await scan(p.id, `${origin}/site/`);
    expect(waits.map((w) => w.timeoutMs)).toEqual([10_000, 10_000]);

    waits.length = 0;
    setOnboardingFetch(async (url, o) => {
      waits.push({ url, timeoutMs: o?.timeoutMs });
      vi.setSystemTime(Date.now() + 25_000);
      return fetchPublicText(url, o);
    });
    const late = await scan(p.id, `${origin}/site/`);
    // robots.txt used 25 of the 30 seconds: the page gets what's left.
    expect(waits[1].timeoutMs).toBeLessThanOrEqual(5_000);
    expect(late.items).toHaveLength(4);

    waits.length = 0;
    setOnboardingFetch(async (url, o) => {
      waits.push({ url, timeoutMs: o?.timeoutMs });
      vi.setSystemTime(Date.now() + 31_000);
      return fetchPublicText(url, o);
    });
    const over = await scan(p.id, `${origin}/site/`);
    expect(waits).toHaveLength(1);
    expect(over.error).toMatch(/30 second limit/);
  });

  it("ONB-02 L10 without BRAND_AI_MODEL nothing is sent to a provider", async () => {
    useProvider("");
    const p = createProject({ name: "Tours", slug: "tours" });
    const d = await scan(p.id, `${origin}/plain/`);
    expect(sent).toHaveLength(0);
    expect(d.brand).toEqual({ name: "Home", color: undefined, logoUrl: undefined });
    expect(parseOnboarding(getProjectById(p.id)!.onboarding).found).toMatchObject({ ai: false });
  });

  it("ONB-02 L10 without BRAND_AI_MODEL the shared AI_* settings are used, with no key when none is set", async () => {
    process.env.AI_API_URL = `${providerOrigin}/v1`;
    process.env.AI_MODEL = "shared-model";
    answer = () => chat({ siteName: null, primaryColor: "#e0457b", testimonials: [] });
    const p = createProject({ name: "Tours", slug: "tours" });
    const d = await scan(p.id, `${origin}/plain/`);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.model).toBe("shared-model");
    expect(sent[0].auth).toBeUndefined();
    expect(d.brand?.color).toBe("#e0457b");
    // BRAND_AI_MODEL, when set, still wins.
    useProvider();
    const q = createProject({ name: "Tours 2", slug: "tours-2" });
    await scan(q.id, `${origin}/plain/`);
    expect(sent[1].body.model).toBe("brand-test-model");
  });

  it("ONB-02 L10 with a provider set, its site name and colour fill what the page's tags leave out, checked against the page", async () => {
    useProvider();
    answer = () => chat({ siteName: "Tamarind Tours", primaryColor: "#e0457b", testimonials: [] });
    const p = createProject({ name: "Tours", slug: "tours" });
    createStarterAssets(p, { businessType: "local" });
    const d = await scan(p.id, `${origin}/plain/`);
    expect(sent).toHaveLength(1);
    expect(sent[0].auth).toBe("Bearer sk-test-brand");
    expect(sent[0].body.model).toBe("brand-test-model");
    const prompt = sent[0].body.messages.find((m) => m.role === "user")!.content;
    // The page's text, title and style colours, never its markup.
    expect(prompt).toContain("Sam Patel told us the evening walk");
    expect(prompt).toContain("#e0457b");
    expect(prompt).not.toContain("<style>");
    // The title "Home" came from the heuristics, so it stays; the colour the page's tags didn't give comes from the provider.
    expect(d.brand).toMatchObject({ name: "Home", color: "#e0457b" });
    expect(parseBrand(getProjectById(p.id)!.brand).colors.primary).toBe("#e0457b");
    expect(parseFormRow(getDefaultForm(p.id)).design.primary).toBe("#e0457b");
    expect(parseOnboarding(getProjectById(p.id)!.onboarding).found).toMatchObject({ ai: true, color: "#e0457b" });

    // A colour the page doesn't use (or a grey) is ignored, and the page's own theme colour always wins.
    answer = () => chat({ siteName: "Wrong", primaryColor: "#00ff00", testimonials: [] });
    const q = createProject({ name: "Tours 2", slug: "tours-2" });
    expect((await scan(q.id, `${origin}/plain/`)).brand?.color).toBeUndefined();
    answer = () => chat({ siteName: "Wrong", primaryColor: "#e0457b", testimonials: [] });
    const r = createProject({ name: "Bakery", slug: "bakery" });
    expect((await scan(r.id, `${origin}/site/`)).brand).toMatchObject({ name: "Larkspur Bakery", color: "#2f6b4f" });
  });

  it("ONB-03 L10 the provider's testimonials join the list only when the quote and name are on the page, once each", async () => {
    useProvider();
    answer = () =>
      chat(
        "```json\n" +
          JSON.stringify({
            siteName: null,
            primaryColor: null,
            testimonials: [
              { authorName: "Sam Patel", authorTitle: null, authorCompany: null, text: "The evening walk was the best thing he did on his whole trip to the city.", rating: 5 },
              // Made up: not on the page.
              { authorName: "Jo Bloggs", text: "Absolutely the finest food tour in the whole country, ten out of ten." },
              // A real quote with an invented name.
              { authorName: "Invented Person", text: "Small-group food walks through the old town." },
              { authorName: "x", text: "too short" },
            ],
          }) +
          "\n```",
      );
    const p = createProject({ name: "Tours", slug: "tours" });
    const d = await scan(p.id, `${origin}/plain/`);
    expect(d.items.map((i) => [i.authorName, i.text, i.rating])).toEqual([["Sam Patel", "The evening walk was the best thing he did on his whole trip to the city.", 5]]);
    expect(d.runId).toBeTruthy();
    // They import like the rest: approved, from the website.
    const imp = await importRoute(post("/api/admin/onboarding/import", { projectId: p.id, runId: d.runId, selection: "all" }));
    expect(imp.status).toBe(200);
    await runDueJobs();
    expect(listTestimonials(p.id).map((t) => [t.authorName, t.status, t.platform])).toEqual([["Sam Patel", "approved", "website"]]);

    // On a page the markup already covers, the same quote suggested again isn't listed twice.
    answer = () => chat({ testimonials: [{ authorName: "Ada Lovelace", text: "Their cinnamon buns turned our office meeting into the highlight of the week!" }] });
    const q = createProject({ name: "Bakery", slug: "bakery" });
    expect((await scan(q.id, `${origin}/site/`)).items.map((i) => i.authorName)).toEqual(["Grace Hopper", "Ada Lovelace", "Katherine Johnson", "Alan Turing"]);
  });

  it("ONB-02 L10 a provider error, junk answer or timeout falls back to the heuristics silently", async () => {
    useProvider();
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const expectHeuristics = async (slug: string) => {
      const p = createProject({ name: slug, slug });
      const d = await scan(p.id, `${origin}/site/`);
      expect(d.error).toBeNull();
      expect(d.brand).toMatchObject({ name: "Larkspur Bakery", color: "#2f6b4f" });
      expect(d.items).toHaveLength(4);
      expect(parseOnboarding(getProjectById(p.id)!.onboarding).found).toMatchObject({ ai: false });
    };
    answer = () => ({ status: 500, body: { error: { message: "server on fire" } } });
    await expectHeuristics("err");
    answer = () => chat("I'm sorry, I can't help with that.");
    await expectHeuristics("prose");
    answer = () => ({ body: "not json" });
    await expectHeuristics("junk");
    answer = () => chat({ siteName: 42, primaryColor: "red", testimonials: "none" });
    const p = createProject({ name: "odd", slug: "odd" });
    expect((await scan(p.id, `${origin}/site/`)).brand).toMatchObject({ name: "Larkspur Bakery", color: "#2f6b4f" });

    // Slower than what's left of the 30 seconds: the scan doesn't wait for it.
    vi.useFakeTimers({ toFake: ["Date"] });
    setOnboardingFetch(async (url, o) => {
      if (url.endsWith("/robots.txt")) vi.setSystemTime(Date.now() + 27_500);
      return fetchPublicText(url, o);
    });
    answer = () => ({ ...chat({ siteName: "Too late" }), delayMs: 4_000 });
    const t0 = performance.now();
    await expectHeuristics("slow");
    expect(performance.now() - t0).toBeLessThan(3_900);
    quiet.mockRestore();
  });
});

describe("the wizard", () => {
  it("ONB-01 makes the project from the answers, imports the chosen finds as approved and ticks the email box", async () => {
    const res = await wizardRoute(post("/api/admin/onboarding", { name: "Larkspur Bakery", website: `${origin}/site/`, businessType: "local", emailMe: true }));
    expect(res.status).toBe(201);
    const { project, scan: run } = (await res.json()) as { project: { id: string; slug: string }; scan: { id: string; status: string } };
    expect(project.slug).toBe("larkspur-bakery");
    expect(run.status).toBe("queued");
    await runDueJobs();
    const found = await scanRoute(new Request(`http://localhost/api/admin/onboarding/discover?projectId=${project.id}&runId=${run.id}`, { headers: adminHeaders() }));
    const { discovery } = (await found.json()) as { discovery: { runId: string; items: { id: string; authorName: string }[] } };
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
    const body = (await res.json()) as { project: { id: string }; scan: { id: string } };
    await runDueJobs();
    const d = getDiscovery(body.project.id, body.scan.id)!;
    expect(d.run.status).toBe("done");
    expect(d.discovery!.error).toMatch(/404/);
    expect(d.discovery!.items).toEqual([]);
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
