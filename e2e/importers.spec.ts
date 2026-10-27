import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminApi, createProject, fixtureRespond, resetFixtures, signIn, useFreshIp } from "./helpers";

/**
 * Importers (IMP-01, IMP-03, IMP-05) against the fixture server, which
 * stands in for the review sites through IMPORTER_ORIGINS.
 */

const RUN = Date.now().toString(36);
const fixture = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", "tests", "fixtures", "importers", p), "utf8");
const FEED = (page: number) => `/importers/appstore/us/rss/customerreviews/page=${page}/id=123456789/sortby=mostrecent/json`;

test.skip(
  process.env.E2E_SERVER_IN_CONTAINER === "true" || Boolean(process.env.E2E_BASE_URL),
  "Needs the suite's own server, which reaches the fixture server",
);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
  await resetFixtures();
});

test("IMP-01 App Store: preview 50, select 20, import with progress; a re-run says 0 new, 20 already imported", async ({ page, baseURL }) => {
  await fixtureRespond({ path: FEED(1), headers: { "content-type": "application/json" }, body: fixture("appstore/page1.json") });
  await fixtureRespond({ path: FEED(2), headers: { "content-type": "application/json" }, body: fixture("appstore/page2.json") });
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Import Co", `imp-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/data`);

  await page.getByTestId("import-source-appstore").click();
  const wizard = page.getByTestId("import-wizard");
  await wizard.getByLabel("App Store link or app ID").fill("https://apps.apple.com/us/app/acme/id123456789");
  await wizard.getByTestId("import-ownership").click();
  await wizard.getByTestId("import-preview-button").click();

  const items = wizard.getByTestId("import-item");
  await expect(items).toHaveCount(50);
  await expect(wizard.getByTestId("import-preview")).toContainText("there are more");
  // Everything new starts selected; pick 20 instead.
  await wizard.getByTestId("import-select-all").click();
  await expect(wizard.getByTestId("import-selected")).toHaveText("Import selected (0)");
  for (let i = 0; i < 20; i++) await items.nth(i).getByRole("checkbox").check();
  await expect(wizard.getByTestId("import-selected")).toHaveText("Import selected (20)");
  await wizard.getByTestId("import-selected").click();

  await expect(wizard.getByTestId("import-progress")).toBeVisible();
  await expect(wizard.getByTestId("import-summary")).toHaveText("20 new, 0 already imported", { timeout: 20_000 });
  await expect(page.getByTestId("import-history")).toContainText("App Store");

  // Again, with the same 20: nothing new.
  await wizard.getByRole("button", { name: "Import more" }).click();
  await wizard.getByTestId("import-preview-button").click();
  await expect(items).toHaveCount(50);
  await expect(items.filter({ hasText: "Already imported" })).toHaveCount(20);
  await wizard.getByTestId("import-select-all").click();
  await wizard.getByTestId("import-select-all").click();
  await expect(wizard.getByTestId("import-selected")).toHaveText("Import selected (0)");
  for (let i = 0; i < 20; i++) await items.nth(i).getByRole("checkbox").check();
  await wizard.getByTestId("import-selected").click();
  await expect(wizard.getByTestId("import-summary")).toHaveText("0 new, 20 already imported", { timeout: 20_000 });

  // In the inbox, each one shows where it came from.
  await page.goto(`/admin/projects/${p.id}`);
  await expect(page.locator('[data-testid="source-icon"][data-platform="appstore"]').first()).toBeVisible();
  const counted = await api.get(`/api/admin/projects/${p.id}/imports`);
  expect((await counted.json()).runs).toHaveLength(2);
});

test("IMP-01 Trustpilot blocked → upload the saved page instead; IMP-05 a month-only date shows Oct 2026", async ({ page, baseURL }) => {
  await fixtureRespond({ path: "/importers/trustpilot/review/acme.example", status: 403, body: "<html><body>Access denied</body></html>" });
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Blocked Co", `blocked-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/data`);

  await page.getByTestId("import-source-trustpilot").click();
  const wizard = page.getByTestId("import-wizard");
  await wizard.getByLabel("Trustpilot page or domain").fill("https://www.trustpilot.com/review/acme.example");
  await wizard.getByTestId("import-ownership").click();
  await wizard.getByTestId("import-preview-button").click();
  await expect(wizard.getByTestId("import-blocked")).toContainText("Upload the saved page instead");

  await wizard.getByTestId("import-html-file").setInputFiles(path.resolve(__dirname, "..", "tests", "fixtures", "importers", "trustpilot", "saved-page.html"));
  const items = wizard.getByTestId("import-item");
  await expect(items).toHaveCount(3);
  await expect(items.filter({ hasText: "Omar Hale" }).getByTestId("import-item-date")).toHaveText("Oct 2026");
  await wizard.getByTestId("import-all").click();
  await expect(wizard.getByTestId("import-summary")).toHaveText("3 new, 0 already imported", { timeout: 20_000 });

  await page.goto(`/admin/projects/${p.id}`);
  await expect(page.locator('[data-testid="source-icon"][data-platform="trustpilot"]')).toHaveCount(3);
});

test("IMP-03 the ownership checkbox is enforced by the server", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Owner Co", `owner-${RUN}`);
  const res = await api.post(`/api/admin/projects/${p.id}/imports/preview`, {
    data: { adapter: "appstore", input: { app: "123456789" }, options: {} },
  });
  expect(res.status()).toBe(400);
  expect(await res.json()).toMatchObject({ code: "ownership" });

  // The dashboard shows the server's answer when the box isn't ticked.
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/data`);
  await page.getByTestId("import-source-appstore").click();
  const wizard = page.getByTestId("import-wizard");
  await wizard.getByLabel("App Store link or app ID").fill("123456789");
  await wizard.getByTestId("import-preview-button").click();
  await expect(wizard.getByRole("alert")).toContainText("I own or manage this listing");
});
