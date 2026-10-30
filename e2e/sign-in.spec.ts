import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";
import { adminApi, freshIp, signIn, useFreshIp } from "./helpers";

/**
 * Signing in with an emailed link, Google and Apple, and inviting people from
 * Settings → Team. Google and Apple are played by e2e/fixtures/mock-oidc.mjs,
 * on another site (localhost vs 127.0.0.1), so Apple's cross-site form_post
 * really is cross-site. Emails are read from .e2e-data/mail-outbox.
 */

const RUN = Date.now().toString(36);
const OUTBOX = path.resolve(__dirname, "..", ".e2e-data", "mail-outbox");

// The stand-in provider and the outbox come with the suite's own server
// (playwright.config.ts), not with an instance given by E2E_BASE_URL.
test.skip(Boolean(process.env.E2E_BASE_URL), "needs the suite's own server, with the stand-in Google/Apple and the mail outbox");

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

/** Waits for the newest email to `to` and returns the link in it. */
async function linkMailedTo(to: string, subject: RegExp) {
  let link = "";
  await expect
    .poll(
      () => {
        if (!fs.existsSync(OUTBOX)) return false;
        for (const file of fs.readdirSync(OUTBOX).sort().reverse()) {
          const raw = fs.readFileSync(path.join(OUTBOX, file), "utf8");
          const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
          if (!head.includes(`To: ${to}`) || !subject.test(head)) continue;
          const body = raw.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
          link = /http:\/\/\S+\/admin\/login\/link\?token=[\w-]+/.exec(body)![0];
          return true;
        }
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return link;
}

async function newVisitor(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  return { context, page: await context.newPage() };
}

/** Picks an account on the stand-in provider's page. */
async function pickAccount(page: Page, email: string, name = "Mock Person") {
  await expect(page).toHaveURL(/localhost:\d+\/(google|apple)\/authorize/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Full name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("the sign-in page offers every method that's set up", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Apple" })).toBeVisible();
  await expect(page.getByTestId("email-link-form")).toBeVisible();
  await expect(page.getByTestId("password-form")).toBeVisible();

  await signIn(page);
  await page.goto("/admin/settings");
  const status = page.getByTestId("sign-in-status");
  for (const method of ["Password", "Email link", "Google", "Apple"]) {
    await expect(status.locator("dt", { hasText: method }).locator("xpath=following-sibling::dd[1]")).toHaveAttribute("data-on", "true");
  }
  await expect(status).toContainText("/api/auth/callback/google");
});

test("an emailed link signs in once, only in the browser that asked for it", async ({ page, browser }) => {
  await page.goto("/admin/login");
  const form = page.getByTestId("email-link-form");
  await form.getByLabel("Email me a sign-in link").fill(E2E_ADMIN.email);
  await form.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toHaveText(/If this address can sign in, we've sent it a link/);
  const link = await linkMailedTo(E2E_ADMIN.email, /Subject: Your Plaudit sign-in link/);

  // Another browser (say, the phone's mail app) can't use it.
  const other = await newVisitor(browser);
  await other.page.goto(link);
  await expect(other.page.getByRole("alert").filter({ hasText: "same browser where you asked for it" })).toBeVisible();
  await other.context.close();

  // Opening it does nothing until the button is pressed (mail scanners open links too).
  await page.goto(link);
  await expect(page.getByText(`as ${E2E_ADMIN.email}`)).toBeVisible();
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto(link);
  await expect(page.getByRole("alert").filter({ hasText: "already been used" })).toBeVisible();
});

test("asking for a link doesn't say whether the address can sign in", async ({ page }) => {
  await page.goto("/admin/login");
  const form = page.getByTestId("email-link-form");
  await form.getByLabel("Email me a sign-in link").fill(`nobody-${RUN}@example.com`);
  await form.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toHaveText(/If this address can sign in, we've sent it a link/);
});

test("Google: sign in, and a clear answer for an address that isn't allowed", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await pickAccount(page, E2E_ADMIN.email);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await pickAccount(page, `stranger-${RUN}@example.com`);
  await expect(page).toHaveURL(/\/admin\/login\?error=not-allowed/);
  await expect(page.getByRole("alert").filter({ hasText: `stranger-${RUN}@example.com isn't allowed to sign in here` })).toBeVisible();
});

test("Apple: the cross-site form_post signs in, and the name sent the first time is kept", async ({ page, browser }) => {
  const pat = `pat-${RUN}@team.example`; // ALLOWED_EMAIL_DOMAINS=team.example
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Continue with Apple" }).click();
  await pickAccount(page, pat, "Pat Appleseed");
  await expect(page).toHaveURL(/\/admin$/);

  // Apple sends no name the second time; it's remembered from the first.
  await page.context().clearCookies();
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Continue with Apple" }).click();
  await pickAccount(page, pat, "");
  await expect(page).toHaveURL(/\/admin$/);

  const owner = await newVisitor(browser);
  await signIn(owner.page);
  await owner.page.goto("/admin/settings");
  await expect(owner.page.getByTestId("team-member").filter({ hasText: pat })).toContainText("Pat Appleseed");
  await owner.context.close();
});

test("the owner invites someone, who accepts by link; removing them signs them out", async ({ page, browser }) => {
  const invitee = `invited-${RUN}@example.com`;
  await signIn(page);
  await page.goto("/admin/settings");
  const team = page.getByTestId("team");
  await team.getByLabel("Invite someone by email").fill(invitee);
  await team.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByTestId("team-message")).toContainText(`Invitation sent to ${invitee}`);
  const row = page.getByTestId("team-member").filter({ hasText: invitee });
  await expect(row).toContainText("Invited, not signed in yet");
  const link = await linkMailedTo(invitee, /Subject: You're invited to Plaudit/);

  // The invitation works in their own browser.
  const them = await newVisitor(browser);
  await them.page.goto(link);
  await expect(them.page.getByRole("heading", { name: "Accept your invitation" })).toBeVisible();
  await them.page.getByRole("button", { name: "Accept and sign in" }).click();
  await expect(them.page).toHaveURL(/\/admin$/);
  // Admins see the team but can't change it.
  await them.page.goto("/admin/settings");
  await expect(them.page.getByTestId("team")).toContainText(invitee);
  await expect(them.page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);

  await page.reload();
  await expect(row).toContainText("Last signed in");
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: `Remove ${invitee}` }).click();
  await expect(page.getByTestId("team-message")).toContainText(`Removed ${invitee}`);

  await them.page.goto("/admin");
  await expect(them.page).toHaveURL(/\/admin\/login/);
  await them.context.close();
});

test("Sign out everywhere in Settings ends the owner's other sessions too, and signing in again works (B-05)", async ({ page, baseURL }) => {
  const other = await adminApi(baseURL!);
  expect((await other.get("/api/admin/projects")).status()).toBe(200);
  await signIn(page);
  await page.goto("/admin/settings");
  const sessions = page.getByTestId("sessions");
  await expect(sessions).toContainText(`Signed in as ${E2E_ADMIN.email}`);
  await sessions.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await other.get("/api/admin/projects")).status()).toBe(401);
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await other.dispose();
});
