import { expect, test } from "@playwright/test";
import { adminApi, createProject, seed, shot, signIn, useFreshIp } from "./helpers";

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
  // Imported beside the original, so it says so rather than looking identical.
  await card.getByRole("link", { name: `Move Co ${RUN} (imported)` }).click();
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

test("L23 L25 SHARE-04 INT-07 INT-08 a case study, a social draft and the Stripe connection come across; the connection asks for its secrets again", async ({ page, baseURL }) => {
  test.slow();
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Shop Co ${RUN}`, `shop-${RUN}`);
  const [id] = await seed(api, p.slug, [{ name: "Ola Owner", text: "Our shop sells twice as much now.", email: "ola@example.com", status: "approved" }]);
  expect((await api.post(`/api/admin/projects/${p.id}/case-studies`, { data: { testimonialId: id } })).status()).toBe(201);
  expect((await api.put(`/api/admin/testimonials/${id}/social-draft`, { data: { text: "Twice the sales. Thanks, Ola!" } })).ok()).toBe(true);
  const connected = await api.put(`/api/admin/projects/${p.id}/stripe`, { data: { signingSecret: "whsec_e2e_moving_123456", retentionDays: 30 } });
  expect(connected.status(), await connected.text()).toBeLessThan(300);

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/data`);
  const download = page.waitForEvent("download");
  await page.getByTestId("export-zip").click();
  const zipPath = test.info().outputPath("shop.zip");
  await (await download).saveAs(zipPath);

  await page.goto("/admin");
  await page.getByTestId("import-file").setInputFiles(zipPath);
  const card = page.getByTestId("import-project");
  await expect(card.getByRole("status")).toContainText("Imported 1 testimonial", { timeout: 30_000 });
  await card.getByRole("link", { name: `Shop Co ${RUN} (imported)` }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const copy = page.url().split("/").pop()!;

  await page.goto(`/admin/projects/${copy}/case-studies`);
  await expect(page.getByTestId("cs-list")).toContainText("Ola Owner");
  await page.goto(`/admin/projects/${copy}/commerce`);
  await expect(page.getByTestId("stripe-state")).toHaveText("Needs its signing secret");
  await expect(page.getByTestId("stripe-last")).toContainText("Paste the signing secret and restricted key again");
  const imported = (await (await api.get(`/api/admin/projects/${copy}/stripe`)).json()).connection;
  expect(imported).toMatchObject({ signingSecretSet: false, restrictedKeySet: false, retentionDays: 30 });

  const [copied] = (await (await api.get(`/api/admin/projects/${copy}/testimonials?tab=approved`)).json()).items as { id: string }[];
  expect((await (await api.get(`/api/admin/testimonials/${copied.id}/social-draft`)).json()).draft).toMatchObject({ text: "Twice the sales. Thanks, Ola!", edited: true });
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
    "Customer,Contact,Their words,Stars,Labels,When",
    'Cleo Csv,cleo@example.com,"Moved over in five minutes, honestly.",★★★★★,"migrated",2025-05-01',
    "Dan Dup,dan@example.com,Fine.,9,,not-a-date",
    "No Words,nw@example.com,,3,,",
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
  await preview.getByLabel("Date").selectOption("When");
  // Values it can't use are listed by line, not silently changed.
  const warnings = preview.getByTestId("csv-warnings");
  await expect(warnings).toContainText('Line 3: Rating "9" isn\'t 1 to 5 stars');
  await expect(warnings).toContainText('Line 3: Date "not-a-date" isn\'t a date we can read');
  await preview.getByLabel(/Approve imported testimonials/).check();
  await shot(page, "import-export", true);
  await preview.getByRole("button", { name: "Import 2 testimonials" }).click();
  const result = page.getByTestId("import-result");
  await expect(result).toContainText("Imported 2 testimonials, skipped 1.");
  await expect(result).toContainText("Skipped: line 4 (No text or video URL)");
  await expect(result.getByTestId("csv-warnings")).toContainText("Imported without some values (2)");
  await expect(result.getByTestId("csv-warnings")).toContainText('Line 3: Rating "9"');

  await page.goto(`/wall/${p.slug}`);
  await expect(page.getByText("Moved over in five minutes, honestly.")).toBeVisible();
  await expect(page.getByLabel("5 out of 5 stars")).toBeVisible();
  await expect(page.getByText("cleo@example.com")).toHaveCount(0);
});
