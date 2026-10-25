import { expect, request as pwRequest, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { adminApi, createProject, freshIp, seed, signIn, useFreshIp } from "./helpers";

/**
 * M1 integration: the Project settings page (TEAM-04) against the real
 * server. It gets the dashboard's nonce policy and headers, its routes refuse
 * cross-site requests, the logo it uploads is served only as an image, old
 * links redirect only within this server, and using the page breaks no
 * Content Security Policy and reaches no other site.
 */

const RUN = Date.now().toString(36);
let n = 0;
const slug = (name: string) => `sec-ps-${name}-${RUN}-${++n}`;

// A real 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const settingsUrl = (id: string) => `/admin/projects/${id}/settings`;

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

async function projectOf(api: APIRequestContext, id: string) {
  const res = await api.get(`/api/admin/projects/${id}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).project as { name: string; slug: string; logoKey: string | null; brand: string };
}

async function tagsOf(api: APIRequestContext, id: string) {
  return ((await (await api.get(`/api/admin/projects/${id}/tags`)).json()).tags as { name: string }[]).map((t) => t.name);
}

test("TEAM-04 project settings sends the dashboard's headers, with a fresh nonce on every response", async ({ page, baseURL }) => {
  const admin = await adminApi(baseURL!);
  const p = await createProject(admin, "Secure Settings Co", slug("headers"));
  const first = await admin.get(settingsUrl(p.id));
  const second = await admin.get(settingsUrl(p.id));
  expect(first.status()).toBe(200);
  const h = first.headers();
  const csp = h["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  for (const directive of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]) {
    expect(csp).toContain(directive);
  }
  expect(second.headers()["content-security-policy"]).not.toBe(csp);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("same-origin");

  // Every script the page ships carries this response's nonce, so nothing else can run.
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  const scripts = (await first.text()).match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);

  // Signed out, it goes to the sign-in page and shows nothing of the project.
  await page.goto(settingsUrl(p.id));
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByText("Secure Settings Co")).toHaveCount(0);
});

test("TEAM-04 project settings changes refuse cross-site requests", async ({ baseURL }) => {
  const admin = await adminApi(baseURL!);
  const s = slug("csrf");
  const p = await createProject(admin, "Csrf Settings Co", s);
  await seed(admin, s, [{ name: "Tess Tagged", text: "Tagged.", tags: ["keep", "also"] }]);
  expect((await admin.post(`/api/admin/projects/${p.id}/slug`, { data: { slug: `${s}-2` } })).status()).toBe(200);
  const [redirect] = (await (await admin.get(`/api/admin/projects/${p.id}/redirects`)).json()).redirects as { id: string }[];
  expect(redirect).toBeTruthy();

  /** Every settings change, sent with these extra headers from the signed-in owner's cookie. */
  const changes = (api: APIRequestContext, headers: Record<string, string>): [string, Promise<APIResponse>][] => [
    ["details", api.patch(`/api/admin/projects/${p.id}`, { data: { name: "Taken Over", brand: { colors: { primary: "#000000" } } }, headers })],
    ["slug", api.post(`/api/admin/projects/${p.id}/slug`, { data: { slug: `${s}-taken` }, headers })],
    ["logo", api.post(`/api/admin/projects/${p.id}/logo`, { multipart: { logo: { name: "logo.png", mimeType: "image/png", buffer: PNG } }, headers })],
    ["remove logo", api.delete(`/api/admin/projects/${p.id}/logo`, { headers })],
    ["rename tag", api.patch(`/api/admin/projects/${p.id}/tags`, { data: { action: "rename", from: "keep", to: "gone" }, headers })],
    ["merge tags", api.patch(`/api/admin/projects/${p.id}/tags`, { data: { action: "merge", from: ["keep", "also"], into: "gone" }, headers })],
    ["delete tag", api.delete(`/api/admin/projects/${p.id}/tags`, { data: { name: "keep" }, headers })],
    ["remove old link", api.delete(`/api/admin/redirects/${redirect.id}`, { headers })],
    ["delete project", api.delete(`/api/admin/projects/${p.id}`, { data: { confirm: "Csrf Settings Co" }, headers })],
  ];

  // A page on another site, posting with the owner's cookie.
  for (const [what, res] of changes(admin, { origin: "https://attacker.example" })) {
    expect((await res).status(), what).toBe(403);
  }
  // No Origin at all, and a browser that says it's cross-site.
  const noOrigin = await pwRequest.newContext({
    baseURL,
    storageState: await admin.storageState(),
    extraHTTPHeaders: { "x-forwarded-for": freshIp() },
  });
  for (const [what, res] of changes(noOrigin, { "sec-fetch-site": "cross-site" })) {
    expect((await res).status(), what).toBe(403);
  }
  for (const [what, res] of changes(noOrigin, {})) {
    expect((await res).status(), what).toBe(403);
  }
  await noOrigin.dispose();

  // Nothing changed.
  const after = await projectOf(admin, p.id);
  expect(after).toMatchObject({ name: "Csrf Settings Co", slug: `${s}-2`, logoKey: null, brand: "{}" });
  expect((await tagsOf(admin, p.id)).sort()).toEqual(["also", "keep"]);
  expect((await admin.get(`/c/${s}`, { maxRedirects: 0 })).status()).toBe(308);
});

test("TEAM-04 the logo is served only as an image, and files that aren't images are refused", async ({ baseURL }) => {
  const admin = await adminApi(baseURL!);
  const p = await createProject(admin, "Logo Safety Co", slug("logo"));
  const upload = (name: string, mimeType: string, buffer: Buffer) =>
    admin.post(`/api/admin/projects/${p.id}/logo`, { multipart: { logo: { name, mimeType, buffer } } });

  const ok = await upload("logo.png", "image/png", PNG);
  expect(ok.status(), await ok.text()).toBe(200);
  const key = (await ok.json()).project.logoKey as string;
  expect(key).toMatch(/^images\/[0-9a-f-]{36}\.png$/);

  // Public, like the collection page that shows it, and never sniffed into anything else.
  const visitor = await pwRequest.newContext({ baseURL });
  const served = await visitor.get(`/api/media/${key}`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");
  expect(served.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await visitor.dispose();

  // An SVG (it can carry script) and a page dressed up as a PNG are refused, and the logo stays.
  const svg = await upload("logo.svg", "image/svg+xml", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));
  expect(svg.status()).toBe(415);
  const html = await upload("logo.png", "image/png", Buffer.from("<!doctype html><script>alert(1)</script>"));
  expect(html.status()).toBe(415);
  expect((await projectOf(admin, p.id)).logoKey).toBe(key);
});

test("TEAM-04 an old link redirects only within this server", async ({ baseURL }) => {
  const admin = await adminApi(baseURL!);
  const s = slug("redirect");
  const p = await createProject(admin, "Redirect Safety Co", s);
  expect((await admin.post(`/api/admin/projects/${p.id}/slug`, { data: { slug: `${s}-new` } })).status()).toBe(200);
  const visitor = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  for (const path of [`/c/${s}`, `/wall/${s}`, `/embed/${s}`]) {
    const res = await visitor.get(`${path}?next=https://attacker.example/&r=x`, { maxRedirects: 0 });
    expect(res.status(), path).toBe(308);
    const to = new URL(res.headers()["location"], baseURL);
    expect(to.origin, path).toBe(new URL(baseURL!).origin);
    expect(to.pathname, path).toBe(path.replace(s, `${s}-new`));
  }
  await visitor.dispose();
});

test("TEAM-04 using project settings breaks no Content Security Policy and reaches no other site", async ({ page, baseURL }) => {
  const admin = await adminApi(baseURL!);
  const s = slug("csp");
  const p = await createProject(admin, "Csp Settings Co", s);
  await seed(admin, s, [{ name: "Cora Csp", text: "Tagged.", tags: ["csp", "policy"] }]);
  expect((await admin.post(`/api/admin/projects/${p.id}/slug`, { data: { slug: `${s}-new` } })).status()).toBe(200);

  const violations = await watchCsp(page);
  const origin = new URL(baseURL!).origin;
  const elsewhere: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if ((u.protocol === "http:" || u.protocol === "https:") && u.origin !== origin) elsewhere.push(r.url());
  });

  await signIn(page);
  await page.goto(settingsUrl(p.id));
  await expect(page.getByRole("heading", { name: "Project settings", level: 1 })).toBeVisible();
  await expect(page.getByTestId("project-link").getByTestId("redirect-row")).toHaveCount(1);

  // The brand kit: a logo (previewed from /api/media), a colour and a font.
  const kit = page.getByTestId("brand-kit");
  await kit.getByLabel("Logo file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(kit.getByTestId("logo-preview")).toBeVisible();
  await expect.poll(() => kit.getByTestId("logo-preview").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1);
  await kit.getByLabel("Primary", { exact: true }).fill("#3d63dd");
  await kit.getByRole("group", { name: "Heading font" }).getByRole("radio", { name: /Serif$/ }).check();
  await kit.getByRole("button", { name: "Save brand kit" }).click();
  await expect(page.getByTestId("settings-toast")).toContainText("Brand kit saved");

  // The dialogs.
  const link = page.getByTestId("project-link");
  await link.getByLabel("Link name").fill(`${s}-newer`);
  await link.getByRole("button", { name: "Change link…" }).click();
  const change = page.getByTestId("change-link-dialog");
  await expect(change).toBeVisible();
  await change.getByRole("button", { name: "Cancel" }).click();
  await expect(change).toBeHidden();
  await page.getByTestId("tags-manager").getByRole("button", { name: "Delete csp" }).click();
  const delTag = page.getByTestId("delete-tag-dialog");
  await expect(delTag).toBeVisible();
  await delTag.getByRole("button", { name: "Cancel" }).click();
  await page.getByTestId("danger-zone").getByRole("button", { name: "Delete project…" }).click();
  const del = page.getByTestId("delete-project-dialog");
  await expect(del).toBeVisible();
  await del.getByRole("button", { name: "Cancel" }).click();
  await expect(del).toBeHidden();
  expect(await violations()).toEqual([]);

  // A reload, so the saved kit renders from the server too (the watcher starts again on each load).
  await page.reload();
  await expect(kit.getByLabel("Primary", { exact: true })).toHaveValue("#3d63dd");
  await expect(kit.getByTestId("logo-preview")).toBeVisible();
  expect(await violations()).toEqual([]);
  expect(elsewhere).toEqual([]);
});
