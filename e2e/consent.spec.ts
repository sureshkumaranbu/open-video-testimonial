import { expect, test } from "@playwright/test";
import { adminApi, allowClipboard, createProject, signIn, useFreshIp } from "./helpers";

/** The consent ledger: versioned wording, scopes, edit tracking and withdrawal. */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("consent wording, scopes, edits and withdrawal are recorded end to end", async ({ page, context, baseURL, browserName }) => {
  await allowClipboard(context, browserName, baseURL!);
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Consent Co", `consent-${RUN}`);

  // The owner rewrites the consent wording.
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByLabel(/Consent wording/).fill("I'm happy for {project} to show this on its site.");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  // A customer sees exactly that wording and also allows social media.
  await page.goto(`/c/${p.slug}`);
  await expect(page.getByTestId("consent-text")).toHaveText("I'm happy for Consent Co to show this on its site.");
  await page.getByLabel("Your testimonial").fill("Clear, kind and quick.");
  await page.getByLabel("Your name").fill("Connie Consent");
  await page.getByLabel(/happy for Consent Co/).check();
  await page.getByLabel(/share it on social media/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  const note = page.getByTestId("withdraw-note");
  await expect(note).toBeVisible();
  const withdrawUrl = (await note.locator(".link-field span").textContent())!;
  expect(withdrawUrl).toMatch(/\/w\/[\w-]{32}$/);
  await note.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(withdrawUrl);

  // The owner sees the record, edits the quote and publishes it.
  await page.goto(`/admin/projects/${p.id}`);
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Connie Consent" });
  const panel = card.getByTestId("consent-panel");
  await expect(panel.locator("summary")).toContainText("website and marketing, social media");
  await panel.locator("summary").click();
  await expect(panel.locator("li[data-type=granted]")).toContainText("I'm happy for Consent Co to show this on its site.");
  await expect(panel.locator("li[data-type=granted]")).toContainText("by customer");
  await expect(panel.locator("li[data-type=granted]")).toContainText(/wording hash [0-9a-f]{12}/);

  await card.getByLabel("Display name").fill("Connie C.");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  const edited = page.getByTestId("admin-testimonial").filter({ hasText: "Connie C." });
  await expect(edited.getByText("Edited after consent")).toBeVisible();
  await edited.getByRole("button", { name: "Approve" }).click();
  await page.goto(`/wall/${p.slug}`);
  await expect(page.getByText("Connie C.")).toBeVisible();

  // The customer withdraws using the private link.
  await page.goto(new URL(withdrawUrl).pathname);
  await expect(page.getByRole("heading", { name: "Withdraw your testimonial?" })).toBeVisible();
  await expect(page.getByText(/as Connie C\./)).toBeVisible();
  await page.getByRole("button", { name: "Withdraw my testimonial" }).click();
  await expect(page.getByRole("status")).toContainText("no longer shown");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Already withdrawn" })).toBeVisible();

  await page.goto(`/wall/${p.slug}`);
  await expect(page.getByText("Connie C.")).toHaveCount(0);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /All/ }).click();
  const gone = page.getByTestId("admin-testimonial").filter({ hasText: "Connie C." });
  await expect(gone.getByTestId("withdrawn-badge")).toBeVisible();
  await expect(gone.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await gone.getByTestId("consent-panel").locator("summary").click();
  await expect(gone.locator("li[data-type]")).toHaveCount(3);
  await expect(gone.locator("li[data-type=edited]")).toContainText("authorName");
  await expect(gone.locator("li[data-type=withdrawn]")).toContainText("by customer");
});

test("a bad withdrawal link explains itself", async ({ page }) => {
  await page.goto("/w/not-a-real-token-not-a-real-token");
  await expect(page.getByRole("heading", { name: "Link not found" })).toBeVisible();
});
