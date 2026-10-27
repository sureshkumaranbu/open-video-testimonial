import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminApi, createProject, freshIp, hostPage, seed, signIn, startHostServer } from "./helpers";
import { formProject } from "./form-helpers";

/**
 * M11 analytics: widget beacons from a cross-origin page and install
 * detection (DISP-13, DISP-14), forms (FORM-15), walls (WALL-05), snippet
 * renders (SEO-04) and the dashboard (AN-01). Cookieless, and nothing ever
 * goes anywhere but the app's own origin.
 */

const RUN = Date.now().toString(36);
const DB = path.resolve(__dirname, "..", ".e2e-data", "plaudit.db");
let host: Awaited<ReturnType<typeof startHostServer>>;

test.beforeAll(async () => {
  host = await startHostServer();
});
test.afterAll(async () => {
  await host.close();
});

type Report = {
  current: { views: number; visitors: number; clicks: Record<string, number>; starts: number; completions: number; renders: number };
  topPages: { dim: string; count: number }[];
  funnel: { pages: { visitors: number }[]; completions: number } | null;
  install: { state: string; lastSeenPage: string | null } | null;
};

async function report(api: APIRequestContext, type: string, id: string): Promise<Report> {
  const res = await api.get(`/api/admin/analytics/${type}/${id}`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).report;
}

/** Every origin a page talks to while it's open. */
function origins(page: Page) {
  const seen = new Set<string>();
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) seen.add(new URL(r.url()).origin);
  });
  return seen;
}

/** A beacon exactly as widget.js sends it: text/plain, no custom headers. */
const beacon = (api: APIRequestContext, id: string, k: string, u = "https://shop.example/pricing") =>
  api.post(`/api/widget/${id}/seen`, { data: JSON.stringify({ k, u }), headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": freshIp() } });

async function project(api: APIRequestContext, name: string) {
  const p = await createProject(api, `${name} ${RUN}`, `${name.toLowerCase().replace(/\W+/g, "-")}-${RUN}`);
  await seed(api, p.slug, [
    { name: "Ada Lovelace", text: `Ada loved it. ${"It saved our team hours every single week. ".repeat(6)}`, rating: 5, status: "approved" },
    { name: "Grace Hopper", text: "Grace loved it too.", rating: 4, status: "approved" },
  ]);
  return p;
}

test("DISP-13 DISP-14 a widget on another site sends a view and clicks to the app only, and its page shows where it's live", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Live widget");
  const { forms } = await (await api.get(`/api/admin/projects/${p.id}/forms`)).json();
  const res = await api.post(`/api/admin/projects/${p.id}/widgets`, {
    data: { name: `Pricing ${RUN}`, layout: "grid", connectedFormId: forms[0].id, config: { design: { readMore: 60 }, cta: { enabled: true, mode: "link" } } },
  });
  expect(res.status()).toBe(201);
  const w = (await res.json()).widget as { id: string };

  // The page has a query and a fragment; neither may reach the server's data.
  host.pages["/analytics/pricing?ref=newsletter&email=ada%40example.com"] = hostPage("Pricing", `<script src="${baseURL}/widget.js" data-widget="${w.id}" async></script>`);
  const seen = origins(page);
  await page.goto(`${host.url}/analytics/pricing?ref=newsletter&email=ada%40example.com#plans`);
  const root = page.locator(`[data-plaudit-widget="${w.id}"]`);
  await expect(root).toHaveAttribute("data-plaudit-ready", "2");
  await expect.poll(async () => (await report(api, "widget", w.id)).current.views, { timeout: 10_000 }).toBe(1);

  // Read more counts as it opens (not as it closes); the call to action opens the form in a new tab.
  await root.getByRole("button", { name: "Read more" }).click();
  await root.getByRole("button", { name: "Read less" }).click();
  const [popup] = await Promise.all([page.waitForEvent("popup"), root.locator("a.b").click()]);
  await popup.close();
  await expect.poll(async () => (await report(api, "widget", w.id)).current.clicks, { timeout: 10_000 }).toMatchObject({ more: 1, cta: 1 });
  expect([...seen].sort()).toEqual([new URL(baseURL!).origin, host.url].sort());

  const r = await report(api, "widget", w.id);
  expect(r.topPages.map((x) => x.dim)).toEqual([`${host.url}/analytics/pricing`]);
  expect(JSON.stringify(r)).not.toContain("newsletter");
  expect(r.install).toMatchObject({ state: "live", lastSeenPage: `${host.url}/analytics/pricing` });

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/widgets/${w.id}`);
  const hostName = new URL(host.url).host;
  await expect(page.getByTestId("install-status")).toContainText(`Live on ${hostName}/analytics/pricing`);
  const panel = page.getByTestId("widget-analytics");
  await expect(panel.getByTestId("tile-views-value")).toHaveText("1");
  await expect(panel.getByTestId("tile-clicks-value")).toHaveText("2");
  await expect(panel.getByTestId("clicks-by-kind")).toContainText("Read more");
  await expect(panel.getByTestId("top-pages")).toContainText(`${hostName}/analytics/pricing`);
  await expect(panel.getByTestId("analytics-chart").getByRole("img")).toHaveAttribute("aria-label", /Views per day/);
  // The widget list says it too.
  await page.goto(`/admin/projects/${p.id}/widgets`);
  await expect(page.locator(`[data-widget-id="${w.id}"]`).getByTestId("widget-stat")).toContainText(`Live on ${hostName}/analytics/pricing · 1 view in 30 days`);
});

test("DISP-13 a widget unseen for 7 days is flagged in the app, with a way to hide the alert", async ({ page, baseURL }) => {
  test.skip(!fs.existsSync(DB), "needs the e2e server's own database");
  const api = await adminApi(baseURL!);
  const p = await project(api, "Gone widget");
  const w = (await (await api.post(`/api/admin/projects/${p.id}/widgets`, { data: { name: `Gone ${RUN}`, layout: "list" } })).json()).widget as { id: string };
  // What the hourly job leaves behind once 7 days pass without a view (the job itself is unit-tested).
  const db = new Database(DB);
  const eightDaysAgo = Date.now() - 8 * 86_400_000;
  db.prepare("UPDATE widgets SET last_seen_at = ?, last_seen_origin = ?, last_seen_path = ?, removed_at = ? WHERE id = ?").run(eightDaysAgo, "https://shop.example", "/pricing", Date.now(), w.id);
  db.close();

  await signIn(page);
  const alert = page.getByTestId("removed-alerts").locator(".an-alert", { hasText: `Gone ${RUN}` });
  await expect(alert).toContainText("shop.example/pricing");
  await page.goto(`/admin/projects/${p.id}/widgets/${w.id}`);
  await expect(page.getByTestId("install-status")).toHaveAttribute("data-state", "removed");
  await expect(page.getByTestId("install-status")).toContainText("Not seen for 7 days");
  await page.getByTestId("dismiss-removed").click();
  await expect(page.getByTestId("dismiss-removed")).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.locator(".an-alert", { hasText: `Gone ${RUN}` })).toHaveCount(0);
  // The email setting for it sits with the other notifications.
  await page.goto("/admin/settings#notifications");
  await expect(page.getByTestId("notify-widget-removed")).toBeVisible();
});

test("FORM-15 the step-by-step form counts views, starts, pages and completions; the classic page counts on the server", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const pages = [{ type: "rating" }, { type: "question", key: "q1", primary: true, title: "What changed?" }, { type: "consent" }, { type: "thank_you" }];
  const { project: p, form, url } = await formProject(api, "Funnel Co", { pages });
  await page.goto(url);
  await expect(page.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");
  await page.getByRole("radio", { name: "5 stars" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("fr-step")).toHaveAttribute("data-step-key", "q1");
  await expect.poll(async () => (await report(api, "form", form.id)).funnel?.pages.map((x) => x.visitors), { timeout: 10_000 }).toEqual([1, 1, 0]);
  await seed(api, p.slug, [{ name: "Ada", text: "Lovely.", rating: 5, formSlug: form.slug }]);
  expect((await report(api, "form", form.id)).current).toMatchObject({ views: 1, visitors: 1, starts: 1, completions: 1 });

  // The classic page: no beacon at all (its markup is as it was); the server counts the view and the send.
  const { forms } = await (await api.get(`/api/admin/projects/${p.id}/forms`)).json();
  const classic = forms.find((f: { isDefault: boolean }) => f.isDefault) as { id: string };
  const collects: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/collect")) collects.push(r.url());
  });
  await page.goto(`/c/${p.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await seed(api, p.slug, [{ name: "Grace", text: "Classic and kind.", rating: 4 }]);
  expect((await report(api, "form", classic.id)).current).toMatchObject({ views: 1, completions: 1 });
  expect(collects).toEqual([]);

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/forms/${form.id}`);
  const panel = page.getByTestId("form-analytics");
  await expect(panel.getByTestId("tile-completions-value")).toHaveText("1");
  await expect(panel.getByTestId("tile-rating-value")).toHaveText("5.0 ★");
  await expect(panel.getByTestId("form-dropoff")).toContainText("1. Rating");
  await expect(panel.getByTestId("form-dropoff")).toContainText("Sent");
});

test("WALL-05 a public wall counts views, visitors and its call to action, without any outside request", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Wall stats");
  const { wall } = await (await api.post(`/api/admin/projects/${p.id}/walls`, { data: { name: "Love" } })).json();
  host.pages["/thanks"] = hostPage("Thanks", "<p>Thanks for visiting</p>");
  const patched = await api.patch(`/api/admin/walls/${wall.id}`, { data: { published: true, config: { heroCta: { enabled: true, text: "Try it free", url: `${host.url}/thanks` } } } });
  expect(patched.status(), await patched.text()).toBe(200);
  const seen = origins(page);
  await page.goto(`/wall/${p.slug}/${wall.slug}`);
  await expect.poll(async () => (await report(api, "wall", wall.id)).current.views, { timeout: 10_000 }).toBe(1);
  expect([...seen]).toEqual([new URL(baseURL!).origin]);
  await page.getByRole("link", { name: "Try it free" }).click();
  await expect(page).toHaveURL(`${host.url}/thanks`);
  await expect.poll(async () => (await report(api, "wall", wall.id)).current.clicks, { timeout: 10_000 }).toMatchObject({ cta: 1, link: 0 });

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/walls/${wall.id}`);
  const panel = page.getByTestId("wall-analytics");
  await expect(panel.getByTestId("tile-views-value")).toHaveText("1");
  await expect(panel.getByTestId("tile-cta-value")).toHaveText("1");
});

test("SEO-04 each load of the dynamic snippet counts as a render, shown on the SEO page", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Snippet stats");
  const made = await api.post(`/api/admin/projects/${p.id}/seo-snippets`, { data: { name: "Pricing page" } });
  expect(made.status(), await made.text()).toBe(201);
  const { snippet } = await made.json();
  host.pages["/product"] = hostPage("Product", `<script src="${baseURL}/schema/${snippet.id}.js"></script>`);
  await page.goto(`${host.url}/product`);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  await expect.poll(async () => (await report(api, "snippet", snippet.id)).current.renders, { timeout: 10_000 }).toBe(1);

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/seo`);
  const card = page.locator(`[data-snippet-id="${snippet.id}"]`);
  await expect(card.getByTestId("snippet-renders")).toHaveText("1 render in 30 days");
  await card.getByTestId("snippet-stats").locator("summary").click();
  await expect(card.getByTestId("tile-renders-value")).toHaveText("1");
});

test("AN-01 the dashboard: tiles with the previous period, a chart, sortable tables, at 360 px and in the dark theme", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Dash Co");
  const make = async (name: string) => ((await (await api.post(`/api/admin/projects/${p.id}/widgets`, { data: { name, layout: "grid" } })).json()).widget as { id: string }).id;
  const home = await make("Home page");
  const pricing = await make("Pricing page");
  for (let i = 0; i < 3; i++) await beacon(api, home, "view");
  await beacon(api, home, "src");
  await beacon(api, pricing, "view");

  await signIn(page);
  await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
  await page.goto(`/admin/analytics?project=${p.id}`);
  const dash = page.getByTestId("analytics-dashboard");
  await expect(dash.getByTestId("tile-widget-views-value")).toHaveText("4");
  await expect(dash.getByTestId("tile-widget-visitors-value")).toHaveText("4");
  await expect(dash.getByTestId("tile-widget-clicks-value")).toHaveText("1");
  await expect(dash.getByTestId("tile-testimonials-value")).toHaveText("2");
  await expect(dash.getByTestId("tile-backlog")).toBeVisible();
  await expect(dash.getByTestId("tile-booster-value")).toHaveText("0");
  await expect(dash.getByTestId("dashboard-chart").getByRole("img")).toHaveAttribute("aria-label", /4 in all/);
  await expect(dash.getByTestId("invite-funnel")).toContainText("No campaign invitations");

  // Busiest first; then by name, A to Z, and back.
  const rows = dash.getByTestId("widgets-table-row");
  await expect(rows.first()).toContainText("Home page");
  await dash.getByTestId("widgets-table").getByTestId("sort-name").click();
  await expect(dash.getByTestId("widgets-table").locator("th").first()).toHaveAttribute("aria-sort", "ascending");
  await expect(rows.first()).toContainText("Home page");
  await dash.getByTestId("widgets-table").getByTestId("sort-name").click();
  await expect(rows.first()).toContainText("Pricing page");

  // A longer period keeps working (there's no 30-day limit).
  await page.getByTestId("range-preset").selectOption("365");
  await expect(dash.getByTestId("tile-widget-views-value")).toHaveText("4");

  // 360 px: nothing wider than the screen.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(dash.getByTestId("tile-widget-views")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  // Dark theme: the chart line and the numbers stay readable on the dark surface.
  const colours = await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    const tile = document.querySelector<HTMLElement>("[data-testid=tile-widget-views]")!;
    const line = document.querySelector<SVGElement>("[data-testid=dashboard-chart] .an-line")!;
    return { bg: getComputedStyle(tile).backgroundColor, text: getComputedStyle(tile).color, line: getComputedStyle(line).stroke };
  });
  expect(colours.bg).toBe("rgb(23, 27, 43)");
  expect(colours.text).not.toBe(colours.bg);
  expect(colours.line).toBe("rgb(138, 168, 255)");
});

test("AN-01 empty states: a new widget says what will show, and the dashboard says when nothing happened", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Quiet ${RUN}`, `quiet-${RUN}`);
  const w = (await (await api.post(`/api/admin/projects/${p.id}/widgets`, { data: { name: "Quiet", layout: "grid" } })).json()).widget as { id: string };
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/widgets/${w.id}`);
  await expect(page.getByTestId("install-status")).toContainText("Not seen on a website yet");
  await expect(page.getByTestId("widget-analytics").getByTestId("analytics-empty")).toContainText("No views yet");
  await page.goto(`/admin/analytics?project=${p.id}`);
  await expect(page.getByTestId("dashboard-chart-empty")).toBeVisible();
  await expect(page.getByTestId("tile-widget-views-value")).toHaveText("0");
});
