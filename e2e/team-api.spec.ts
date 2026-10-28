import crypto from "node:crypto";
import { type Browser, expect, request as pwRequest, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";
import { adminApi, createProject, freshIp, seed, signIn, useFreshIp } from "./helpers";

/**
 * M14 in the production build: generic OpenID Connect sign-in (TEAM-03,
 * against the stand-in provider's generic issuer, labelled "Acme SSO" in
 * playwright.config.ts), the API's new paths (API-01, API-02) and the MCP
 * server (INT-04) with a key made in Settings; roles (TEAM-01) for people
 * signing in through that provider, the audit log (TEAM-02), and a Stripe
 * trigger fired with a signed test event (REQ-07).
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
  await page.locator('select[name="scope"]').selectOption("write");
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
  expect((await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } })).serverInfo.name).toBe(
    "plaudit",
  );
  expect((await rpc("tools/list")).tools.map((t: { name: string }) => t.name)).toContain("create_invite");
  const summary = await rpc("tools/call", { name: "summarize", arguments: { project: slug } });
  expect(summary.structuredContent).toMatchObject({ total: 1, approved: { count: 1, averageRating: 5 } });
  const embeds = await rpc("tools/call", { name: "get_embed_codes", arguments: { project: slug } });
  expect(embeds.structuredContent.widgets[0].id).toBe(w.id);
  expect((await api.get("/mcp")).status()).toBe(405);
  await api.dispose();
  await admin.dispose();
});

/** Signs `email` in through the stand-in single sign-on, in a fresh browser context. */
async function ssoContext(browser: Browser, email: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Continue with Acme SSO" }).click();
  await pickAccount(page, email);
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
  return { context, page };
}

/** A same-origin dashboard request from the page, as its own buttons make them. */
const fromPage = (page: Page, url: string, method: string, body?: unknown) =>
  page.evaluate(
    async ([u, m, b]) =>
      (
        await fetch(u as string, {
          method: m as string,
          headers: { "Content-Type": "application/json" },
          body: b === undefined ? undefined : JSON.stringify(b),
        })
      ).status,
    [url, method, body] as const,
  );

test("TEAM-01 a viewer limited to one project sees only it, can't change it, and has no admin settings; an editor can approve", async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(baseURL!);
  const mine = await createProject(admin, `Viewed ${RUN}`, `viewed-${RUN}`);
  const other = await createProject(admin, `Hidden ${RUN}`, `hidden-${RUN}`);
  const [tid] = await seed(admin, mine.slug, [{ name: "Ada", text: "Waiting for review." }]);
  const viewer = `vee-${RUN}@example.com`;
  const editor = `eddie-${RUN}@example.com`;
  for (const [email, role] of [
    [viewer, "viewer"],
    [editor, "editor"],
  ] as const) {
    const res = await admin.post("/api/admin/team", { data: { email, role, projectIds: [mine.id] } });
    expect(res.status(), await res.text()).toBe(201);
  }

  const v = await ssoContext(browser, viewer);
  await expect(v.page.getByTestId("role-badge")).toHaveText("Viewer");
  await expect(v.page.getByRole("link", { name: new RegExp(`Viewed ${RUN}`) })).toBeVisible();
  await expect(v.page.getByRole("link", { name: new RegExp(`Hidden ${RUN}`) })).toHaveCount(0);
  await v.page.goto(`/admin/projects/${other.id}`);
  await expect(v.page.getByText("This page could not be found")).toBeVisible();
  await v.page.goto(`/admin/projects/${mine.id}`);
  expect(await fromPage(v.page, `/api/admin/testimonials/${tid}`, "PATCH", { status: "approved" })).toBe(403);
  await v.page.goto("/admin/settings");
  await expect(v.page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(v.page.getByRole("heading", { name: "API keys" })).toHaveCount(0);
  await expect(v.page.getByTestId("team")).toHaveCount(0);
  await v.context.close();

  const e = await ssoContext(browser, editor);
  await expect(e.page.getByTestId("role-badge")).toHaveText("Editor");
  await e.page.goto(`/admin/projects/${mine.id}`);
  expect(await fromPage(e.page, `/api/admin/testimonials/${tid}`, "PATCH", { status: "approved" })).toBe(200);
  expect(await fromPage(e.page, "/api/admin/api-keys", "GET")).toBe(403);
  await e.context.close();

  // The owner sees both people and their roles in Settings › Team.
  const owner = await browser.newPage();
  await useFreshIp(owner);
  await signIn(owner);
  await owner.goto("/admin/settings");
  await expect(owner.getByTestId("team-member").filter({ hasText: viewer }).getByTestId("team-role")).toContainText(`Viewer (invited)`);
  await expect(owner.getByTestId("team-member").filter({ hasText: editor }).getByTestId("team-role")).toContainText(`Viewed ${RUN}`);
  await owner.close();
  await admin.dispose();
});

test("TEAM-02 the audit log shows who approved and exported, and filters by action", async ({ page, baseURL }) => {
  const admin = await adminApi(baseURL!);
  const p = await createProject(admin, `Audited ${RUN}`, `audited-${RUN}`);
  const [tid] = await seed(admin, p.slug, [{ name: "Grace", text: "Logged." }]);
  expect((await admin.patch(`/api/admin/testimonials/${tid}`, { data: { status: "approved" } })).ok()).toBe(true);
  expect((await admin.get(`/api/admin/projects/${p.id}/export?format=csv`)).ok()).toBe(true);

  await signIn(page);
  await page.goto("/admin/settings");
  await page.getByTestId("audit-link").click();
  await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
  const approved = page.getByTestId("audit-row").filter({ hasText: "Approved a testimonial" }).filter({ hasText: "Grace" });
  await expect(approved).toContainText(E2E_ADMIN.email);
  await expect(approved).toContainText(`Audited ${RUN}`);

  await page.locator('select[name="action"]').selectOption({ label: "Any export" });
  await page.locator('select[name="project"]').selectOption({ label: `Audited ${RUN}` });
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/action=export\./);
  await expect(page.getByTestId("audit-row")).toHaveCount(1);
  await expect(page.getByTestId("audit-row")).toContainText("Exported testimonials (CSV)");
  await admin.dispose();
});

test("REQ-07 a Stripe trigger set up on the campaign page invites the buyer of a signed test event, 7 days later", async ({ page, baseURL }) => {
  const admin = await adminApi(baseURL!);
  const system = await (await admin.get("/api/admin/system")).json();
  test.skip(system.email.mode === "off", "needs email (MAIL_OUTBOX) for a campaign to send");
  const p = await createProject(admin, `Shop ${RUN}`, `shop-${RUN}`);
  const res = await admin.post(`/api/admin/projects/${p.id}/campaigns`, { data: { name: "After purchase" } });
  const { campaign } = (await res.json()) as { campaign: { id: string } };
  expect((await admin.patch(`/api/admin/campaigns/${campaign.id}`, { data: { status: "active" } })).ok()).toBe(true);

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/campaigns/${campaign.id}`);
  await page.getByRole("tab", { name: "Auto-collect" }).click();
  await page.getByTestId("add-stripe").click();
  const card = page.getByTestId("trigger").filter({ hasText: "Stripe" });
  await expect(card.getByTestId("trigger-state")).toHaveText("Needs its signing secret");
  const secret = `whsec_e2e_${RUN}_0123456789`;
  await card.getByTestId("trigger-secret").fill(secret);
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByTestId("trigger-state")).toHaveText("On");
  const url = await card.getByTestId("trigger-url").locator("input, textarea").first().inputValue();
  expect(url).toMatch(/\/api\/hooks\/stripe\/[0-9a-f-]{36}$/);

  // Stripe's test event, signed as Stripe signs it.
  const raw = JSON.stringify({
    id: `evt_${RUN}`,
    type: "checkout.session.completed",
    data: { object: { payment_status: "paid", customer_details: { email: `buyer-${RUN}@example.com`, name: "Bea Buyer" } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const outside = await pwRequest.newContext();
  const bad = await outside.post(url, { data: raw, headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${"0".repeat(64)}` } });
  expect(bad.status()).toBe(400);
  const ok = await outside.post(url, { data: raw, headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` } });
  expect(ok.status(), await ok.text()).toBe(200);
  const answer = await ok.json();
  expect(Date.parse(answer.scheduledFor) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
  await outside.dispose();

  await expect
    .poll(async () => ((await (await admin.get(`/api/admin/campaigns/${campaign.id}`)).json()).recipients as { email: string }[]).map((r) => r.email), {
      timeout: 15_000,
    })
    .toEqual([`buyer-${RUN}@example.com`]);
  await page.reload();
  await page.getByRole("tab", { name: "Auto-collect" }).click();
  await expect(page.getByTestId("trigger").getByTestId("trigger-last")).toContainText(`Invited buyer-${RUN}@example.com (7 days later)`);
  await admin.dispose();
});
