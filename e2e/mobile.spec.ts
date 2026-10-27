import { expect, test, type Page } from "@playwright/test";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/**
 * Definition of done: every Phase 1 page fits a 360 px phone with no
 * horizontal scrolling, the dashboard and the public pages alike.
 */

const RUN = Date.now().toString(36);

test.use({ viewport: { width: 360, height: 740 } });

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

async function fits(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect.soft(scroll, `${url} scrolls sideways (${scroll} px wide at ${width} px)`).toBeLessThanOrEqual(width + 1);
}

test("DOD every new page fits 360 px with no horizontal scroll", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Phone Fit", `phone-${RUN}`);
  await seed(api, p.slug, [
    { name: "Ada Lovelace", text: "A long testimonial that wraps over several lines on a small phone screen without pushing anything sideways.", rating: 5, status: "approved", tags: ["pricing"] },
    { name: "Grace Hopper", text: "Short and sweet.", rating: 4 },
  ]);
  const forms = (await (await api.get(`/api/admin/projects/${p.id}/forms`)).json()).forms as { id: string; slug: string; isDefault: boolean }[];
  const form = (await (await api.post(`/api/admin/projects/${p.id}/forms`, { data: { name: "Stories", template: "saas" } })).json()).form as { id: string; slug: string };
  const widget = (await (await api.post(`/api/admin/projects/${p.id}/widgets`, { data: { name: "Home", layout: "carousel" } })).json()).widget as { id: string };
  const wall = (await (await api.post(`/api/admin/projects/${p.id}/walls`, { data: { name: "Love" } })).json()).wall as { id: string; slug: string };
  await api.patch(`/api/admin/walls/${wall.id}`, { data: { published: true } });

  await signIn(page);
  const base = `/admin/projects/${p.id}`;
  for (const url of [
    "/admin",
    "/admin/welcome",
    "/admin/settings",
    base,
    `${base}/forms`,
    `${base}/forms/${forms[0].id}`,
    `${base}/forms/${form.id}`,
    `${base}/widgets`,
    `${base}/widgets/${widget.id}`,
    `${base}/walls`,
    `${base}/walls/${wall.id}`,
    `${base}/seo`,
    `${base}/data`,
    `${base}/requests`,
    `${base}/settings`,
    `/f/${p.slug}/${form.slug}`,
    `/c/${p.slug}`,
    `/wall/${p.slug}`,
    `/wall/${p.slug}/${wall.slug}`,
    `/embed/${widget.id}`,
  ]) {
    await fits(page, url);
  }
});
