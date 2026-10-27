import { expect, test, type Page } from "@playwright/test";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/**
 * M5 integration: walls keep the public security rules. Wall pages and their
 * OG images refuse framing and carry the public CSP, user text stays text
 * (in the HTML and in the JSON-LD), private fields never appear, draft
 * walls and their images are 404, and the wall and SEO pages run without a
 * Content Security Policy violation.
 */

const RUN = Date.now().toString(36);
const EVIL = `<img src=x onerror="window.__pwned=1"></script><script>window.__pwned=2</script>`;

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __csp?: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp!.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as Window & { __csp?: string[] }).__csp ?? []);
}

async function fixture(baseURL: string, name: string) {
  const api = await adminApi(baseURL);
  const project = await createProject(api, `${name} ${RUN}`, `${name}-${RUN}`);
  await seed(api, project.slug, [
    { name: `Eve ${EVIL}`, email: `eve-${RUN}@example.com`, text: `Great ${EVIL} product`, rating: 5, status: "approved", tags: ["pro"] },
    { name: "Bob Private", email: `bob-${RUN}@example.com`, text: "Fine", rating: 4, status: "approved" },
  ]);
  const { wall } = await (await api.post(`/api/admin/projects/${project.id}/walls`, { data: { name: "Love" } })).json();
  return { api, project, wall: wall as { id: string; slug: string } };
}

test("WALL-03 wall pages and OG images refuse framing and carry the public CSP; drafts are 404 everywhere", async ({ baseURL }) => {
  const { api, project, wall } = await fixture(baseURL!, "secwall");
  const path = `/wall/${project.slug}/${wall.slug}`;
  for (const url of [path, `${path}/opengraph-image`, `/api/walls/${wall.id}/items`]) expect((await api.get(url)).status(), url).toBe(404);

  await api.patch(`/api/admin/walls/${wall.id}`, { data: { published: true } });
  for (const url of [path, `${path}/opengraph-image`]) {
    const res = await api.get(url);
    expect(res.status(), url).toBe(200);
    expect(res.headers()["x-frame-options"], url).toBe("DENY");
    expect(res.headers()["content-security-policy"], url).toContain("frame-ancestors 'none'");
    expect(res.headers()["x-content-type-options"], url).toBe("nosniff");
  }
  const items = await api.get(`/api/walls/${wall.id}/items`);
  expect(items.status()).toBe(200);
  const body = await items.text();
  expect(body).not.toMatch(/email|@example\.com|consent/i);
  // Unknown ids are a plain 404.
  expect((await api.get(`/api/walls/not-a-wall/items`)).status()).toBe(404);
});

test("WALL-03 SEO-03 hostile text stays text in the cards and the JSON-LD, with no private fields", async ({ page, baseURL }) => {
  const { api, project, wall } = await fixture(baseURL!, "secxss");
  await api.patch(`/api/admin/walls/${wall.id}`, {
    data: { published: true, config: { tabs: { enabled: true, items: [{ label: "All" }, { label: "Pro", tag: "pro" }] }, inlineCta: { enabled: true, after: 1 } } },
  });
  const csp = await watchCsp(page);
  const res = await page.goto(`/wall/${project.slug}/${wall.slug}`);
  const html = await res!.text();
  await expect(page.getByText("Great <img src=x", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __pwned?: number }).__pwned)).toBeUndefined();
  expect(html).not.toContain(`@example.com`);
  // One JSON-LD block, and the review's "</script>" can't close it.
  const ld = page.locator('script[type="application/ld+json"]');
  await expect(ld).toHaveCount(1);
  const data = JSON.parse((await ld.textContent())!);
  expect(JSON.stringify(data)).toContain("</script><script>window.__pwned=2</script>");
  expect(JSON.stringify(data)).not.toMatch(/email|@example\.com/i);
  expect(html).not.toContain("<script>window.__pwned");
  await page.getByRole("link", { name: "Pro" }).click();
  await expect(page.getByTestId("wall-grid").locator("article")).toHaveCount(1);
  expect(await csp()).toEqual([]);
});

test("WALL-01 SEO-01 the wall editor and the SEO page run without CSP violations", async ({ page, baseURL }) => {
  const { project, wall } = await fixture(baseURL!, "seccsp");
  const csp = await watchCsp(page);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/walls/${wall.id}`);
  await expect(page.getByTestId("wall-preview").getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("wall-preview")).toContainText("Great <img src=x");
  expect(await page.evaluate(() => (window as Window & { __pwned?: number }).__pwned)).toBeUndefined();
  await page.goto(`/admin/projects/${project.id}/seo`);
  await expect(page.getByTestId("snippet-form")).toBeVisible();
  expect(await csp()).toEqual([]);
});
