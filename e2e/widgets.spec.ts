import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { adminApi, createProject, FIXTURES, hostPage, seed, startHostServer } from "./helpers";

/**
 * M4 renderer (WP4.2): every saved layout through `data-widget` on a hostile,
 * cross-origin host page; keyboard and motion rules; the toast's per-session
 * dismissal; the HTML include with JavaScript off; and data-project embeds
 * drawing exactly what the previous widget.js drew.
 */

const RUN = Date.now().toString(36);
let host: Awaited<ReturnType<typeof startHostServer>>;

test.beforeAll(async () => {
  host = await startHostServer();
});
test.afterAll(async () => {
  await host.close();
});
// No useFreshIp here: an extra request header would make every cross-origin widget fetch a CORS preflight.

type Fixture = { api: APIRequestContext; project: { id: string; slug: string } };

async function project(baseURL: string, name: string, n = 4): Promise<Fixture> {
  const api = await adminApi(baseURL);
  const p = await createProject(api, `${name} ${RUN}`, `${name.toLowerCase().replace(/\W+/g, "-")}-${RUN}`);
  const people = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Linus Pauling", "Mary Somerville"];
  await seed(
    api,
    p.slug,
    people.slice(0, n).map((name, i) => ({ name, text: `${name.split(" ")[0]} loved it, number ${i + 1}.`, rating: i === 3 ? 3 : 5 - (i % 2), status: "approved" as const })),
  );
  return { api, project: p };
}

async function widget(f: Fixture, layout: string, config: object = {}) {
  const res = await f.api.post(`/api/admin/projects/${f.project.id}/widgets`, { data: { name: `${layout} ${RUN}`, layout, config } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).widget as { id: string };
}

const tag = (baseURL: string, id: string) => `<script src="${baseURL}/widget.js" data-widget="${id}" async></script>`;

test("DISP-04 every layout renders through data-widget on a hostile cross-origin host", async ({ page, baseURL }) => {
  const f = await project(baseURL!, "Layouts");
  const layouts = ["grid", "list", "carousel", "slider", "marquee", "featured", "badge", "toast"];
  const ids: Record<string, string> = {};
  for (const l of layouts) ids[l] = (await widget(f, l, { options: { toastDelay: 0 }, aggregate: { show: true } })).id;
  host.pages["/layouts"] = hostPage("Layouts", layouts.map((l) => `<section id="s-${l}">${tag(baseURL!, ids[l])}</section>`).join(""));
  await page.goto(`${host.url}/layouts`);

  for (const l of layouts) {
    const w = page.locator(`[data-plaudit-widget="${ids[l]}"]`);
    await expect(w, l).toHaveAttribute("data-plaudit-ready", "4");
    await expect(w).toHaveAttribute("data-layout", l);
  }
  const at = (l: string) => page.locator(`[data-plaudit-widget="${ids[l]}"]`);
  await expect(at("grid").locator(".grid article.c")).toHaveCount(4);
  await expect(at("list").locator(".list article.c")).toHaveCount(4);
  await expect(at("carousel").locator(".sl:not([hidden]) article.c")).toHaveCount(1);
  await expect(at("slider").locator(".sl")).toHaveCount(4);
  // The marquee loops a hidden second copy of its cards.
  await expect(at("marquee").locator("article.c:not([aria-hidden])")).toHaveCount(4);
  await expect(at("featured").locator(".ft article.c")).toHaveCount(1);
  await expect(at("badge").locator("a.bd")).toContainText("4 reviews");
  await expect(at("badge").locator("a.bd")).toHaveAttribute("href", `${baseURL}/wall/${f.project.slug}`);
  await expect(at("toast").locator(".ts article.c")).toBeVisible();
  // DISP-07: the rating summary above the cards.
  await expect(at("grid").locator(".agg")).toContainText("4 reviews");
  // The host's `* { color: red !important }` doesn't reach inside.
  const color = await at("list").getByText("Ada Lovelace").evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe("rgb(255, 0, 0)");
  // Only the core and the lazy layout files were fetched from the app (no other origin).
  await expect(page.locator("[data-plaudit-error]")).toHaveCount(0);
});

test("DISP-04 the carousel moves with arrows, dots and arrow keys, and Tab focus pauses autoplay", async ({ page, baseURL }) => {
  const f = await project(baseURL!, "Carousel");
  const w = await widget(f, "carousel", { options: { delay: 2 } });
  host.pages["/carousel"] = hostPage("Carousel", `<a href="#" id="before">Before</a>${tag(baseURL!, w.id)}`);
  await page.goto(`${host.url}/carousel`);
  const root = page.locator(`[data-plaudit-widget="${w.id}"]`);
  await expect(root).toHaveAttribute("data-plaudit-ready", "4");
  const region = root.locator(".cr");
  const visible = region.locator(".sl:not([hidden])");
  await expect(region).toHaveAttribute("aria-roledescription", "carousel");
  await expect(region).toHaveAttribute("data-autoplay", "");

  // Keyboard: Tab into the carousel pauses it.
  await page.locator("#before").focus();
  await page.keyboard.press("Tab");
  await expect(region).toHaveAttribute("data-paused", "focus");
  const first = await visible.getAttribute("aria-label");
  await page.waitForTimeout(3000); // longer than one autoplay step (2 s)
  await expect(visible).toHaveAttribute("aria-label", first!);
  await page.keyboard.press("ArrowRight");
  await expect(visible).toHaveAttribute("aria-label", "2 / 4");
  await page.keyboard.press("ArrowLeft");
  await expect(visible).toHaveAttribute("aria-label", "1 / 4");

  await region.getByRole("button", { name: "Next" }).click();
  await expect(visible).toHaveAttribute("aria-label", "2 / 4");
  await region.getByRole("button", { name: "4 / 4" }).click();
  await expect(visible).toHaveAttribute("aria-label", "4 / 4");
  await expect(region.getByRole("button", { name: "4 / 4" })).toHaveAttribute("aria-current", "true");
  // The pause button stops it for good.
  await region.getByRole("button", { name: "Pause" }).click();
  await expect(region.getByRole("button", { name: "Play" })).toBeVisible();
});

test("DISP-04 the slider pauses while hovered and steps one card at a time", async ({ page, baseURL }) => {
  const f = await project(baseURL!, "Slider", 5);
  const w = await widget(f, "slider", { options: { delay: 2, perView: 2 } });
  host.pages["/slider"] = hostPage("Slider", `<div style="width:900px">${tag(baseURL!, w.id)}</div>`);
  await page.goto(`${host.url}/slider`);
  const root = page.locator(`[data-plaudit-widget="${w.id}"]`);
  await expect(root).toHaveAttribute("data-plaudit-ready", "5");
  const shown = root.locator('.sl[aria-hidden="false"]');
  await expect(shown).toHaveCount(2);
  await root.locator(".sd .vp").hover();
  const before = await shown.first().getAttribute("aria-label");
  await page.waitForTimeout(3000);
  await expect(shown.first()).toHaveAttribute("aria-label", before!);
  await root.getByRole("button", { name: "Next" }).click();
  await expect(shown.first()).not.toHaveAttribute("aria-label", before!);
  // Cards out of view are inert, so Tab skips them.
  await expect(root.locator('.sl[aria-hidden="true"]').first()).toHaveAttribute("inert", "");
});

test("DISP-04 reduced motion stops the marquee and carousel autoplay", async ({ page, baseURL }) => {
  const f = await project(baseURL!, "Motion");
  const mq = await widget(f, "marquee", { options: { rows: 2 } });
  const cr = await widget(f, "carousel");
  host.pages["/motion"] = hostPage("Motion", tag(baseURL!, mq.id) + tag(baseURL!, cr.id));

  await page.goto(`${host.url}/motion`);
  const marquee = page.locator(`[data-plaudit-widget="${mq.id}"]`);
  await expect(marquee).toHaveAttribute("data-plaudit-ready", "4");
  await expect(marquee.locator(".tk").first()).toHaveCSS("animation-name", "mq");
  await expect(marquee.locator(".row")).toHaveCount(2);
  // Hover pauses the scrolling.
  await marquee.locator(".mq").hover();
  await expect(marquee.locator(".tk").first()).toHaveCSS("animation-play-state", "paused");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(marquee).toHaveAttribute("data-plaudit-ready", "4");
  await expect(marquee.locator(".tk").first()).toHaveCSS("animation-name", "none");
  // No looping copies and no pause button: nothing moves.
  await expect(marquee.locator("article.c")).toHaveCount(4);
  await expect(marquee.getByRole("button", { name: "Pause" })).toHaveCount(0);
  const carousel = page.locator(`[data-plaudit-widget="${cr.id}"]`);
  await expect(carousel).toHaveAttribute("data-plaudit-ready", "4");
  await expect(carousel.locator(".cr")).not.toHaveAttribute("data-autoplay", "");
  await expect(carousel.getByRole("button", { name: "Pause" })).toHaveCount(0);
});

test("DISP-04 a dismissed toast stays away for the rest of the session", async ({ browser, baseURL }) => {
  const f = await project(baseURL!, "Toast", 2);
  const w = await widget(f, "toast", { options: { toastDelay: 0, toastPosition: "bottom-right" } });
  host.pages["/toast"] = hostPage("Toast", `<p>Shop</p>${tag(baseURL!, w.id)}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${host.url}/toast`);
  const root = page.locator(`[data-plaudit-widget="${w.id}"]`);
  const toast = root.locator(".ts");
  await expect(toast.locator("article.c")).toBeVisible();
  await expect(toast).toHaveClass(/bottom-right/);
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toBeHidden();
  await page.reload();
  await expect(root).toHaveAttribute("data-plaudit-ready", "2");
  await expect(root.locator(".ts")).toHaveCount(0);
  await context.close();

  // A new visit (a fresh session) shows it again.
  const fresh = await browser.newContext();
  const again = await fresh.newPage();
  await again.goto(`${host.url}/toast`);
  await expect(again.locator(`[data-plaudit-widget="${w.id}"] .ts article.c`)).toBeVisible();
  await fresh.close();
});

test("DISP-06 the popup CTA opens the connected form in a dialog", async ({ page, baseURL }) => {
  const f = await project(baseURL!, "Cta", 1);
  const formRes = await f.api.post(`/api/admin/projects/${f.project.id}/forms`, { data: { name: "Stories" } });
  const form = (await formRes.json()).form as { id: string; slug: string };
  const res = await f.api.post(`/api/admin/projects/${f.project.id}/widgets`, {
    data: { name: "Cta", layout: "list", connectedFormId: form.id, config: { cta: { enabled: true, mode: "popup" }, labels: { cta: "Share your story" } } },
  });
  const w = (await res.json()).widget as { id: string };
  host.pages["/cta"] = hostPage("Cta", tag(baseURL!, w.id));
  await page.goto(`${host.url}/cta`);
  const root = page.locator(`[data-plaudit-widget="${w.id}"]`);
  await root.getByRole("button", { name: "Share your story" }).click();
  const dialog = root.locator("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("iframe")).toHaveAttribute("src", `${baseURL}/embed/${f.project.slug}/form/${form.slug}`);
  await dialog.getByRole("button", { name: "Dismiss" }).click();
  await expect(dialog).toHaveCount(0);
});

test("DISP-10 the HTML include shows the review text with JavaScript off", async ({ browser, baseURL }) => {
  const f = await project(baseURL!, "Include", 2);
  const w = await widget(f, "carousel");
  const html = await (await f.api.get(`/api/widget/${w.id}/html?jsonld=1`)).text();
  host.pages["/include"] = hostPage("Include", `<main>${html}</main>`);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${host.url}/include`);
  await expect(page.getByText("Ada loved it, number 1.")).toBeVisible();
  await expect(page.getByText("Grace loved it, number 2.")).toBeVisible();
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  await context.close();
});

test("DISP-01 data-project embeds draw exactly what the previous widget.js drew", async ({ page, baseURL }) => {
  const f = await project(baseURL!, "Legacy", 3);
  const v0 = fs.readFileSync(path.join(FIXTURES, "widget-v0.js"), "utf8");
  // The previous release's widget.js, served from the app's origin like the real one.
  await page.route(`${baseURL}/widget-v0.js`, (route) => route.fulfill({ contentType: "text/javascript", body: v0 }));
  const both = (layout: string, theme: string) =>
    `<div id="old-${layout}"></div><div id="new-${layout}"></div>` +
    `<script src="${baseURL}/widget-v0.js" data-project="${f.project.slug}" data-layout="${layout}" data-theme="${theme}" data-target="#old-${layout}" async></script>` +
    `<script src="${baseURL}/widget.js" data-project="${f.project.slug}" data-layout="${layout}" data-theme="${theme}" data-target="#new-${layout}" async></script>`;
  host.pages["/legacy"] = hostPage("Legacy", both("grid", "light") + both("list", "dark"));
  await page.goto(`${host.url}/legacy`);
  for (const layout of ["grid", "list"]) {
    const old = page.locator(`#old-${layout}`);
    const now = page.locator(`#new-${layout}`);
    await expect(old).toHaveAttribute("data-plaudit-ready", "3");
    await expect(now).toHaveAttribute("data-plaudit-ready", "3");
    const shadow = (sel: string) => page.evaluate((s) => document.querySelector(s)!.shadowRoot!.innerHTML, sel);
    expect(await shadow(`#new-${layout}`)).toBe(await shadow(`#old-${layout}`));
    const attrs = (sel: string) =>
      page.evaluate((s) => [...document.querySelector(s)!.attributes].filter((a) => a.name !== "id").map((a) => `${a.name}=${a.value}`), sel);
    expect(await attrs(`#new-${layout}`)).toEqual(await attrs(`#old-${layout}`));
  }
});
