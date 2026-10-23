import path from "node:path";
import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import { adminApi, createProject, FIXTURES, seed, signIn, useFreshIp } from "./helpers";

/** Release QA: headers, media takedown, bad links, rate limits against the real server. */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

/** Collects Content Security Policy violations reported on the page. */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __csp?: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp!.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as Window & { __csp?: string[] }).__csp ?? []);
}

test("security headers on public pages, the dashboard and the embed", async ({ baseURL, request }) => {
  const admin = await adminApi(baseURL!);
  const p = await createProject(admin, "Headers Co", `headers-${RUN}`);
  const header = async (url: string) => (await request.get(url)).headers();

  for (const url of ["/", `/c/${p.slug}`, `/wall/${p.slug}`, "/api/widget/" + p.slug]) {
    const h = await header(url);
    expect(h["x-content-type-options"], url).toBe("nosniff");
    expect(h["referrer-policy"], url).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"], url).toBe("DENY");
    expect(h["content-security-policy"], url).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"], url).toContain("object-src 'none'");
  }

  // The dashboard: a fresh nonce on every response, and nothing inline without it.
  const a = await header("/admin/login");
  const b = await header("/admin/login");
  expect(a["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(a["content-security-policy"]).not.toContain("unsafe-inline' 'unsafe");
  expect(a["content-security-policy"]).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(a["content-security-policy"]).not.toBe(b["content-security-policy"]);
  expect(a["x-frame-options"]).toBe("DENY");
  expect(a["x-content-type-options"]).toBe("nosniff");

  // The iframe embed is the one page other sites may frame.
  const e = await header(`/embed/${p.slug}`);
  expect(e["content-security-policy"]).toContain("frame-ancestors *");
  expect(e["x-frame-options"]).toBeUndefined();
  expect(e["x-content-type-options"]).toBe("nosniff");
});

test("no page breaks its own Content Security Policy", async ({ page, baseURL }) => {
  const admin = await adminApi(baseURL!);
  const p = await createProject(admin, "Csp Co", `csp-${RUN}`);
  await seed(admin, p.slug, [
    { name: "Vera Video", text: "On camera.", video: true, status: "approved" },
    { name: "Pat Pending", text: "Waiting.", video: true },
  ]);
  const violations = await watchCsp(page);

  await page.goto("/");
  await expect(page.getByTestId("hero-demo")).toBeVisible();
  expect(await violations(), "home").toEqual([]);

  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded");
  await expect(page.getByLabel("Your recording")).toBeVisible(); // a blob: preview
  expect(await violations(), "collect").toEqual([]);

  for (const url of [`/wall/${p.slug}`, `/embed/${p.slug}`]) {
    await page.goto(url);
    await expect(page.locator("video").first()).toBeVisible();
    expect(await violations(), url).toEqual([]);
  }

  // Signing in needs the dashboard's scripts to run under the nonce policy.
  await signIn(page);
  await page.getByRole("link", { name: "Csp Co" }).first().click();
  await expect(page.getByText("Pat Pending")).toBeVisible();
  await expect(page.locator("video").first()).toBeVisible(); // private media, served to the owner
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  expect(await violations(), "dashboard").toEqual([]);
});

test("rejecting or withdrawing a testimonial takes its media down at once", async ({ baseURL }) => {
  const admin = await adminApi(baseURL!);
  const p = await createProject(admin, "Takedown Co", `takedown-${RUN}`);
  const [id] = await seed(admin, p.slug, [{ name: "Tara Takedown", text: "Here today.", video: true, status: "approved" }]);
  const visitor = await pwRequest.newContext({ baseURL });
  const widget = await (await visitor.get(`/api/widget/${p.slug}`)).json();
  const videoUrl = new URL(widget.testimonials[0].video.url, baseURL).pathname;

  const first = await visitor.get(videoUrl);
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toBe("public, no-cache");

  expect((await admin.patch(`/api/admin/testimonials/${id}`, { data: { status: "rejected" } })).ok()).toBe(true);
  const gone = await visitor.get(videoUrl);
  expect(gone.status()).toBe(404);
  expect((await admin.get(videoUrl)).status()).toBe(200); // the owner still sees it
  expect((await admin.get(videoUrl)).headers()["cache-control"]).toBe("private, no-store");

  expect((await admin.patch(`/api/admin/testimonials/${id}`, { data: { status: "pending" } })).ok()).toBe(true);
  expect((await visitor.get(videoUrl)).status()).toBe(404);
  expect((await admin.patch(`/api/admin/testimonials/${id}`, { data: { status: "approved" } })).ok()).toBe(true);
  expect((await visitor.get(videoUrl)).status()).toBe(200);
});

test("bad withdrawal and unsubscribe links are a 404 with a friendly page", async ({ page }) => {
  for (const url of ["/w/not-a-real-token", "/u/not-a-real-token"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(404);
    await expect(page.getByRole("heading", { name: "Link not found" })).toBeVisible();
  }
});

test("every page has a favicon", async ({ page, request }) => {
  const ico = await request.get("/favicon.ico");
  expect(ico.status()).toBe(200);
  expect(ico.headers()["content-type"]).toMatch(/image\/(x-icon|vnd\.microsoft\.icon)/);
  await page.goto("/");
  const href = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
  expect(href).toMatch(/^\/icon\.svg/);
  expect((await request.get(href!)).status()).toBe(200);
});

test("a made-up client address doesn't get round the submission limit", async ({ baseURL }) => {
  const admin = await adminApi(baseURL!);
  const p = await createProject(admin, "Limit Co", `limit-${RUN}`);
  const anon = await pwRequest.newContext({ baseURL });
  const submit = (headers: Record<string, string>) =>
    anon.post(`/api/projects/${p.slug}/testimonials`, {
      multipart: { name: "Spammer", text: "Buy now", consent: "on" },
      headers,
    });
  // The test server trusts one proxy (TRUST_PROXY=1), so only the last
  // X-Forwarded-For entry counts; whatever a client writes before it doesn't.
  const fixed = `198.18.250.${Math.floor(Math.random() * 250)}`;
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    statuses.push((await submit({ "x-forwarded-for": `203.0.113.${i}, ${fixed}`, "x-plaudit-peer": `192.0.2.${i}` })).status());
  }
  expect(statuses.slice(0, 10)).toEqual(Array(10).fill(201));
  expect(statuses.slice(10)).toEqual([429, 429]);
  // Someone else is unaffected.
  expect((await submit({ "x-forwarded-for": `198.18.251.${Math.floor(Math.random() * 250)}` })).status()).toBe(201);
});
