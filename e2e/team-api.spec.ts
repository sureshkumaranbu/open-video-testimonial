import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/**
 * M14 in the production build: generic OpenID Connect sign-in (TEAM-03,
 * against the stand-in provider's generic issuer, labelled "Acme SSO" in
 * playwright.config.ts), the API's new paths (API-01, API-02) and the MCP
 * server (INT-04) with a key made in Settings.
 */

const RUN = Date.now().toString(36);

test.skip(Boolean(process.env.E2E_BASE_URL), "needs the suite's own server, with the stand-in OpenID provider");

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

/** Picks an account on the stand-in provider's generic sign-in page. */
async function pickAccount(page: Page, email: string) {
  await expect(page).toHaveURL(/localhost:\d+\/oidc\/authorize/, { timeout: 15_000 });
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("TEAM-03 Continue with single sign-on: the owner gets in, a stranger is told no, and Settings shows it on", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Continue with Acme SSO" }).click();
  await pickAccount(page, E2E_ADMIN.email);
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/admin/settings");
  const status = page.getByTestId("sign-in-status");
  const sso = status.locator("dt", { hasText: "Single sign-on (OIDC)" }).locator("xpath=following-sibling::dd[1]");
  await expect(sso).toHaveAttribute("data-on", "true");
  await expect(sso).toContainText("/api/auth/callback/oidc");

  await page.context().clearCookies();
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Continue with Acme SSO" }).click();
  await pickAccount(page, `stranger-${RUN}@example.com`);
  await expect(page).toHaveURL(/\/admin\/login\?error=not-allowed/, { timeout: 15_000 });
  await expect(page.getByRole("alert").filter({ hasText: `stranger-${RUN}@example.com isn't allowed to sign in here` })).toBeVisible();
});

test("TEAM-03 an unverified address is refused, and someone at an allowed domain gets in", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Continue with Acme SSO" }).click();
  await expect(page).toHaveURL(/\/oidc\/authorize/, { timeout: 15_000 });
  await page.getByLabel("Email address").fill(`ada-${RUN}@team.example`);
  await page.getByLabel("Email verified").uncheck();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/login\?error=unverified/, { timeout: 15_000 });
  await expect(page.getByRole("alert").filter({ hasText: "isn't verified" })).toBeVisible();

  await page.getByRole("link", { name: "Continue with Acme SSO" }).click();
  await pickAccount(page, `ada-${RUN}@team.example`); // ALLOWED_EMAIL_DOMAINS=team.example
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
});

test("API-01 API-02 INT-04 a key made in Settings drives the new API paths and the MCP server", async ({ page, baseURL }) => {
  const admin = await adminApi(baseURL!);
  const slug = `m14-${RUN}`;
  await createProject(admin, "M14 Co", slug);
  await seed(admin, slug, [{ name: "Ada", text: "Setup took ten minutes.", rating: 5, status: "approved" }]);

  // The key, made in the dashboard like a person would.
  await signIn(page);
  await page.goto("/admin/settings");
  await expect(page.getByTestId("mcp-url")).toContainText(`${new URL(baseURL!).origin}/mcp`);
  await page.getByLabel("Key name").fill(`m14 ${RUN}`);
  await page.getByLabel("Access").selectOption("write");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.getByTestId("new-api-key").locator("code").textContent())!;
  expect(key).toMatch(/^plk_/);

  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${key}` } });
  const widget = await api.post(`/api/v1/projects/${slug}/widgets`, { data: { name: "Home", layout: "list" } });
  expect(widget.status(), await widget.text()).toBe(201);
  const w = (await widget.json()).data;
  expect(w.embed.script).toContain(`data-widget="${w.id}"`);
  const forms = await (await api.get(`/api/v1/projects/${slug}/forms`)).json();
  expect(forms.data[0]).toMatchObject({ isDefault: true });
  const analytics = await api.get(`/api/v1/projects/${slug}/analytics`);
  expect(analytics.status()).toBe(200);
  expect((await analytics.json()).data.range).toEqual({ from: expect.any(String), to: expect.any(String) });
  const spec = await (await api.get("/api/v1/openapi.json")).json();
  expect(Object.keys(spec.paths)).toContain("/projects/{slug}/widgets");

  const rpc = async (method: string, params?: unknown) => {
    const res = await api.post("/mcp", {
      data: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
      headers: { accept: "application/json, text/event-stream" },
    });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).result;
  };
  expect((await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } })).serverInfo.name).toBe("plaudit");
  expect((await rpc("tools/list")).tools.map((t: { name: string }) => t.name)).toContain("create_invite");
  const summary = await rpc("tools/call", { name: "summarize", arguments: { project: slug } });
  expect(summary.structuredContent).toMatchObject({ total: 1, approved: { count: 1, averageRating: 5 } });
  const embeds = await rpc("tools/call", { name: "get_embed_codes", arguments: { project: slug } });
  expect(embeds.structuredContent.widgets[0].id).toBe(w.id);
  expect((await api.get("/mcp")).status()).toBe(405);
  await api.dispose();
  await admin.dispose();
});
