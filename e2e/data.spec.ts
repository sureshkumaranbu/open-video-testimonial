import { expect, test } from "@playwright/test";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/** Export a project, import it back as a new one, and import a CSV with the column mapper. */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("export everything, then import it as a new project", async ({ page, baseURL }) => {
  test.slow();
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Move Co ${RUN}`, `move-${RUN}`);
  await seed(api, p.slug, [
    { name: "Mia Mover", text: "Coming with us.", email: "mia@example.com", status: "approved", tags: ["home"] },
    { name: "Vic Video", video: true, status: "approved" },
    { name: "Pat Pending", text: "Still waiting." },
  ]);

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Import & export" }).click();
  await expect(page.getByText(/all 3 testimonials/)).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByTestId("export-zip").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(new RegExp(`^plaudit-move-${RUN}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
  const zipPath = test.info().outputPath("export.zip");
  await file.saveAs(zipPath);

  const csvDownload = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/);

  // Import on the admin home page.
  await page.goto("/admin");
  await page.getByTestId("import-file").setInputFiles(zipPath);
  const card = page.getByTestId("import-project");
  await expect(card.getByRole("status")).toContainText("Imported 3 testimonials into", { timeout: 30_000 });
  await card.getByRole("link", { name: `Move Co ${RUN}` }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toContain(p.id);

  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /All/ }).click();
  const rows = page.getByTestId("admin-testimonial");
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Mia Mover" })).toHaveAttribute("data-status", "approved");
  await expect(rows.filter({ hasText: "Mia Mover" }).getByLabel(/Tags/)).toHaveValue("home");
  await expect(rows.filter({ hasText: "Vic Video" }).locator("video")).toBeVisible();
  const consent = rows.filter({ hasText: "Mia Mover" }).getByTestId("consent-panel");
  await consent.locator("summary").click();
  await expect(consent.locator("li[data-type=imported]")).toContainText("Imported from a Plaudit export");
});

test("a bad file gets a clear message", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("import-file").setInputFiles({ name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("not a zip") });
  await expect(page.getByTestId("import-project").getByRole("alert")).toContainText("Not a ZIP file");
});

test("CSV import with the column mapper", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Csv Co", `csv-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/data`);
  const csv = [
    "Customer,Contact,Their words,Stars,Labels",
    'Cleo Csv,cleo@example.com,"Moved over in five minutes, honestly.",★★★★★,"migrated"',
    "Dan Dup,dan@example.com,Fine.,4/5,",
    "No Words,nw@example.com,,3,",
  ].join("\n");
  await page.getByTestId("csv-file").setInputFiles({ name: "old-tool.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

  const preview = page.getByTestId("csv-preview");
  await expect(preview).toContainText("3 rows, 0 ready to import");
  // "Customer" and "Their words" aren't standard names; map them by hand.
  await preview.getByLabel("Name (required)").selectOption("Customer");
  await preview.getByLabel("Testimonial text").selectOption("Their words");
  await expect(preview).toContainText("3 rows, 2 ready to import");
  await expect(preview.getByLabel("Email")).toHaveValue("");
  await preview.getByLabel("Email").selectOption("Contact");
  await expect(preview.getByTestId("preview-row").first()).toContainText("5/5");
  await expect(preview).toContainText("line 4 (No text or video URL)");
  await preview.getByLabel(/Approve imported testimonials/).check();
  await preview.getByRole("button", { name: "Import 2 testimonials" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 2 testimonials, skipped 1.");

  await page.goto(`/wall/${p.slug}`);
  await expect(page.getByText("Moved over in five minutes, honestly.")).toBeVisible();
  await expect(page.getByLabel("5 out of 5 stars")).toBeVisible();
  await expect(page.getByText("cleo@example.com")).toHaveCount(0);
});
