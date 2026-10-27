import { expect, test, type APIRequestContext } from "@playwright/test";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/**
 * M5 walls (WP5.2), the milestone demo: publish /wall/<project>/love from the
 * editor with a hero, tag tabs and an inline CTA after 6 cards; a draft is a
 * 404; the server HTML has escaped JSON-LD and the meta tags with JS off;
 * the OG image renders; load more and phones work; and /wall/<project>
 * stays the legacy page until a wall is marked main.
 */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

async function fixture(baseURL: string, name: string, count = 14) {
  const api = await adminApi(baseURL);
  const project = await createProject(api, `${name} ${RUN}`, `${name.toLowerCase()}-${RUN}`);
  await seed(api, project.slug, [
    ...Array.from({ length: count }, (_, i) => ({
      name: `Fan ${String(i).padStart(2, "0")}`,
      text: i === count - 1 ? "Best </script><script>window.pwned=1</script> tool" : `Fan ${i} enjoys the product.`,
      rating: i % 3 === 0 ? 4 : 5,
      status: "approved" as const,
      tags: i % 2 === 0 ? ["pro"] : [],
      email: `fan${i}@private.example`,
    })),
    { name: "Pending Pete", text: "Not yet", status: "pending" as const },
  ]);
  return { api, project };
}

async function newWall(api: APIRequestContext, projectId: string, name: string) {
  const res = await api.post(`/api/admin/projects/${projectId}/walls`, { data: { name } });
  expect(res.status()).toBe(201);
  return (await res.json()).wall as { id: string; slug: string };
}

test("WALL-01 WALL-02 publish /wall/<project>/love from the editor with a hero, tabs and an inline CTA after 6 cards", async ({ page, baseURL }) => {
  const { project } = await fixture(baseURL!, "Love");
  const path = `/wall/${project.slug}/love`;

  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/walls`);
  await expect(page.getByTestId("walls-empty")).toBeVisible();
  await page.getByLabel("New wall name").fill("Love");
  await page.getByRole("button", { name: "Create wall" }).click();
  await expect(page).toHaveURL(/\/walls\/[0-9a-f-]{36}$/);
  const editor = page.getByTestId("wall-editor");
  await expect(editor.getByTestId("wall-status")).toHaveText("Draft");

  // A draft is a 404 for visitors.
  expect((await page.request.get(path)).status()).toBe(404);

  // Hero.
  await editor.getByLabel("Title", { exact: true }).fill("Loved by busy teams");
  await editor.getByLabel("Subtitle").fill("Real words from real customers.");
  const preview = page.getByTestId("wall-preview");
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText("Loved by busy teams");

  // Tabs and the inline CTA.
  await editor.getByRole("tab", { name: "Testimonials" }).click();
  await editor.getByTestId("tabs-enabled").getByRole("switch").check();
  await editor.getByRole("button", { name: "Add a tab" }).click();
  const rows = editor.getByTestId("wall-tab-row");
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByLabel("Tab 2 label").fill("Pros");
  await rows.nth(1).getByLabel("Shows").selectOption("pro");
  await editor.getByTestId("inline-cta-enabled").getByRole("switch").check();
  await editor.getByLabel("Heading").fill("Your turn");
  await expect(preview.getByTestId("wall-inline-cta")).toContainText("Your turn");

  // Look: a theme of our own.
  await editor.getByRole("tab", { name: "Look" }).click();
  await editor.getByTestId("theme-sunrise").click();
  await expect(preview.locator(".wl-page")).toHaveAttribute("data-wall-theme", "sunrise");

  await page.getByTestId("save-wall").click();
  await expect(page.getByTestId("save-wall")).toHaveText("Saved");

  // Publish.
  await editor.getByRole("tab", { name: "Publish" }).click();
  await editor.getByTestId("wall-publish").getByRole("button", { name: "Published" }).click();
  await expect(editor.getByTestId("wall-status")).toHaveText("Published");

  // The visitor's page.
  const visitor = await (await page.context().browser()!.newContext()).newPage();
  await visitor.goto(path);
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText("Loved by busy teams");
  await expect(visitor.locator(".wl-page")).toHaveAttribute("data-wall-theme", "sunrise");
  const grid = visitor.getByTestId("wall-grid");
  const order = await grid.locator(":scope > article, :scope > .wl-span").evaluateAll((els) =>
    els.map((e) => (e.querySelector("[data-testid=wall-inline-cta]") ? "cta" : e.tagName === "ARTICLE" ? "card" : "other")),
  );
  expect(order.indexOf("cta")).toBe(6);
  expect(await visitor.content()).not.toContain("private.example");
  await expect(visitor.getByText("Pending Pete")).toHaveCount(0);
  expect(await visitor.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();

  // Tabs filter by tag (links, so they work without JavaScript).
  await visitor.getByTestId("wall-tabs").getByRole("link", { name: "Pros" }).click();
  await expect(visitor).toHaveURL(new RegExp(`${path}\\?tab=1$`));
  await expect(visitor.getByTestId("wall-tabs").getByRole("link", { name: "Pros" })).toHaveAttribute("aria-current", "page");
  await expect(grid.locator("article")).toHaveCount(7);
  await visitor.context().close();
});

test("WALL-01 load more and infinite scroll fetch the next page; phones get one column", async ({ page, baseURL }) => {
  const { api, project } = await fixture(baseURL!, "More", 9);
  const wall = await newWall(api, project.id, "More");
  const patch = await api.patch(`/api/admin/walls/${wall.id}`, { data: { published: true, config: { layout: { pageSize: 4, columns: 3 } } } });
  expect(patch.ok()).toBe(true);
  const path = `/wall/${project.slug}/${wall.slug}`;
  await page.goto(path);
  const cards = page.getByTestId("wall-grid").locator("article");
  await expect(cards).toHaveCount(4);
  await page.getByTestId("wall-load-more").click();
  await expect(cards).toHaveCount(8);
  await page.getByTestId("wall-load-more").click();
  await expect(cards).toHaveCount(9);
  await expect(page.getByTestId("wall-load-more")).toHaveCount(0);

  // Infinite: once the end of the list is near (it is, on a short page), the next pages load by themselves.
  await api.patch(`/api/admin/walls/${wall.id}`, { data: { config: { layout: { pageSize: 4, pagination: "infinite" } } } });
  await page.goto(path);
  await page.mouse.wheel(0, 4000);
  await expect(cards).toHaveCount(9, { timeout: 10_000 });
  await expect(page.getByTestId("wall-load-more")).toHaveCount(0);

  // A draft's items are not public.
  await api.patch(`/api/admin/walls/${wall.id}`, { data: { published: false } });
  expect((await page.request.get(`/api/walls/${wall.id}/items?offset=4`)).status()).toBe(404);

  await api.patch(`/api/admin/walls/${wall.id}`, { data: { published: true } });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(path);
  const [a, b] = await cards.evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().left));
  expect(a).toBe(b);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("WALL-03 SEO-03 server HTML with JS off: meta, canonical, escaped JSON-LD; the OG image renders; noindex", async ({ browser, baseURL }) => {
  const { api, project } = await fixture(baseURL!, "Seo", 14);
  const wall = await newWall(api, project.id, "Love");
  await api.patch(`/api/admin/walls/${wall.id}`, {
    data: { published: true, config: { hero: { title: "Loved by teams" }, seo: { title: "Acme reviews", description: "Real words." } } },
  });
  const path = `/wall/${project.slug}/love`;
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  const res = await page.goto(path);
  const html = await res!.text();
  expect(html).not.toContain("<script>window.pwned");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Loved by teams");
  await expect(page.locator("article").first()).toBeVisible();
  await expect(page).toHaveTitle("Acme reviews");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Real words.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}${path}`);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld).toMatchObject({ "@context": "https://schema.org", "@type": "Product", aggregateRating: { "@type": "AggregateRating", ratingCount: 14 } });
  expect(ld.review).toHaveLength(10);
  expect(html).toContain("\\u003c/script\\u003e");

  // The link preview image.
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toContain(`${path}/opengraph-image`);
  const img = await page.request.get(og!);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toBe("image/png");
  expect((await img.body()).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  // noindex.
  const cfg = (await (await api.get(`/api/admin/walls/${wall.id}`)).json()).wall.config;
  await api.patch(`/api/admin/walls/${wall.id}`, { data: { config: { ...cfg, seo: { ...cfg.seo, noindex: true } } } });
  await page.goto(path);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // A draft's image is a 404 too.
  await api.patch(`/api/admin/walls/${wall.id}`, { data: { published: false } });
  expect((await page.request.get(`${baseURL}${path}/opengraph-image`)).status()).toBe(404);
  expect((await page.request.get(`${baseURL}${path}`)).status()).toBe(404);
  await ctx.close();
});

test("WALL-01 legacy /wall/<project> stays the same until a published wall is marked main", async ({ page, baseURL }) => {
  const { api, project } = await fixture(baseURL!, "Main", 3);
  await page.goto(`/wall/${project.slug}`);
  await expect(page.locator(".wall-page")).toBeVisible();
  await expect(page.locator("article.testimonial")).toHaveCount(3);
  // The legacy page carries JSON-LD too.
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld.review).toHaveLength(3);

  const wall = await newWall(api, project.id, "Main wall");
  expect((await api.post(`/api/admin/walls/${wall.id}/main`, { data: { main: true } })).ok()).toBe(true);
  await page.goto(`/wall/${project.slug}`);
  await expect(page.locator(".wall-page")).toBeVisible();

  await api.patch(`/api/admin/walls/${wall.id}`, { data: { published: true, config: { hero: { title: "Our main wall" } } } });
  await page.goto(`/wall/${project.slug}`);
  await expect(page.locator(".wl-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Our main wall");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/wall/${project.slug}`);

  await api.post(`/api/admin/walls/${wall.id}/main`, { data: { main: false } });
  await page.goto(`/wall/${project.slug}`);
  await expect(page.locator(".wall-page")).toBeVisible();
});
