import { expect, test, type Page } from "@playwright/test";
import { adminApi, createProject, hostPage, seed, signIn, startHostServer, useFreshIp } from "./helpers";

/**
 * M4 integration: saved widgets keep the security rules. Only /embed/w_… can
 * be framed, the feed and include carry public fields only and render user
 * text as text, and the studio (which loads widget.js and its layout files)
 * runs without a Content Security Policy violation or an off-site request.
 */

const RUN = Date.now().toString(36);
const EVIL = `<img src=x onerror="window.__pwned=1">`;

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
    { name: `Eve ${EVIL}`, email: `eve-${RUN}@example.com`, text: `Great ${EVIL} product`, rating: 5, status: "approved" },
    { name: "Bob Private", email: `bob-${RUN}@example.com`, text: "Fine", rating: 4, status: "approved" },
  ]);
  return { api, project };
}

test("DISP-09 /embed/w_… can be framed while /api/widget/w_… refuses framing", async ({ baseURL }) => {
  const { api, project } = await fixture(baseURL!, "secframe");
  const { widget } = await (await api.post(`/api/admin/projects/${project.id}/widgets`, { data: { name: "W", layout: "grid" } })).json();
  const embed = await api.get(`/embed/${widget.id}`);
  expect(embed.status()).toBe(200);
  expect(embed.headers()["x-frame-options"]).toBeUndefined();
  expect(embed.headers()["content-security-policy"]).toContain("frame-ancestors *");
  for (const path of [`/api/widget/${widget.id}`, `/api/widget/${widget.id}/html`]) {
    const res = await api.get(path);
    expect(res.headers()["x-frame-options"], path).toBe("DENY");
    expect(res.headers()["access-control-allow-origin"], path).toBe("*");
  }
  expect((await api.get("/embed/w_zzzzzzzzzzzz")).status()).toBe(404);
});

test("DISP-03 the widget feed and HTML include carry public fields only and escape markup", async ({ browser, baseURL }) => {
  const { api, project } = await fixture(baseURL!, "secfeed");
  const { widget } = await (await api.post(`/api/admin/projects/${project.id}/widgets`, { data: { name: "W", layout: "list", config: { design: { firstNameOnly: true } } } })).json();
  const feed = await (await api.get(`/api/widget/${widget.id}`)).text();
  expect(feed).not.toContain("@example.com");
  expect(feed).not.toContain("Private");
  expect(feed.toLowerCase()).not.toMatch(/"[a-z]*email[a-z]*":/);
  const html = await (await api.get(`/api/widget/${widget.id}/html?jsonld=1`)).text();
  expect(html).not.toContain("@example.com");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("&lt;img src=x");

  // On a host page, the widget and the include both show the markup as text.
  const host = await startHostServer();
  host.pages["/x"] = hostPage("X", `<div id="inc">${html}</div><script src="${baseURL}/widget.js" data-widget="${widget.id}" async></script>`);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${host.url}/x`);
  await expect(page.locator(`[data-plaudit-widget="${widget.id}"]`)).toHaveAttribute("data-plaudit-ready", "2");
  await expect(page.locator(`div[data-plaudit-widget="${widget.id}"]`).getByText(`Great ${EVIL} product`)).toBeVisible();
  await expect(page.locator("#inc").getByText(`Great ${EVIL} product`)).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator("img[src=x]").count()).toBe(0);
  await page.context().close();
  await host.close();
});

test("DISP-12 the widgets list and studio run without CSP violations or off-site requests", async ({ page, baseURL }) => {
  const { api, project } = await fixture(baseURL!, "seccsp");
  const { widget } = await (await api.post(`/api/admin/projects/${project.id}/widgets`, { data: { name: "W", layout: "grid" } })).json();
  const violations = await watchCsp(page);
  const origin = new URL(baseURL!).origin;
  const offsite: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["data:", "blob:"].includes(u.protocol) && u.origin !== origin) offsite.push(r.url());
  });
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/widgets`);
  await expect(page.getByTestId("widget-row")).toHaveCount(1);
  await page.goto(`/admin/projects/${project.id}/widgets/${widget.id}`);
  const preview = page.getByTestId("widget-preview-host");
  await expect(preview).toHaveAttribute("data-plaudit-ready", "2");
  // Lazy layout files load under the dashboard's strict policy too.
  for (const l of ["carousel", "marquee", "toast", "badge"]) {
    await page.getByTestId(`layout-${l}`).click();
    await expect(preview).toHaveAttribute("data-layout", l);
  }
  await expect(preview.locator(".bd")).toContainText("2 reviews");
  await page.getByRole("tab", { name: "Share" }).click();
  await expect(page.getByTestId("snippet-script")).toBeVisible();
  expect(await violations()).toEqual([]);
  expect(offsite).toEqual([]);
});
