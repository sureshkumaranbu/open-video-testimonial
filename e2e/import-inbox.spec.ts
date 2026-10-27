import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminApi, createProject, fixtureRespond, resetFixtures, seed, signIn, useFreshIp } from "./helpers";

/**
 * M13: XLSX and pasted tables (IMP-04), auto-sync (IMP-02), duplicates and
 * merge (INBOX-11), customer records (INBOX-12), translations (INBOX-13) and
 * smart search's keyword fallback (INBOX-14). Review sites are the fixture
 * server, through IMPORTER_ORIGINS.
 */

const RUN = Date.now().toString(36);
const ROOT = path.resolve(__dirname, "..", "tests", "fixtures");
const FEED = (page: number) => `/importers/appstore/us/rss/customerreviews/page=${page}/id=123456789/sortby=mostrecent/json`;
let n = 0;
const slug = (s: string) => `${s}-${RUN}-${++n}`;

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("IMP-04 an Excel file and a table pasted from a spreadsheet go through the same mapper, preview and warnings", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Sheets Co", slug("sheets"));
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/data`);
  await expect(page.getByRole("heading", { name: "Import testimonials from a spreadsheet or CSV" })).toBeVisible();

  await page.getByTestId("csv-file").setInputFiles({
    name: "reviews.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fs.readFileSync(path.join(ROOT, "xlsx", "openpyxl.xlsx")),
  });
  const preview = page.getByTestId("csv-preview");
  await expect(page.getByTestId("csv-summary")).toContainText("4 rows, 4 ready to import");
  await expect(page.getByTestId("csv-warnings")).toContainText("Rating \"9\" isn't 1 to 5 stars");
  await expect(preview.getByTestId("preview-row").first()).toContainText("Rowan Field");
  await preview.getByRole("button", { name: "Import 4 testimonials" }).click();
  await expect(page.getByTestId("import-result")).toContainText("Imported 4 testimonials");

  await page.getByTestId("paste-toggle").click();
  await page.getByTestId("paste-table").fill("Name\tTestimonial\tRating\nPia Paste\tCopied straight from our sheet.\t5\n");
  await page.getByTestId("paste-preview").click();
  await expect(page.getByTestId("csv-summary")).toContainText("1 rows, 1 ready to import");
  await page.getByRole("button", { name: "Import 1 testimonial" }).click();
  await expect(page.getByTestId("import-result")).toContainText("Imported 1 testimonial");
  const rows = (await (await api.get(`/api/admin/projects/${p.id}/testimonials?tab=all&size=25`)).json()).items as { authorName: string }[];
  expect(rows.map((r) => r.authorName)).toEqual(expect.arrayContaining(["Rowan Field", "Pia Paste"]));
});

test.describe("needs the fixture server", () => {
  test.skip(process.env.E2E_SERVER_IN_CONTAINER === "true" || Boolean(process.env.E2E_BASE_URL), "Needs the suite's own server, which reaches the fixture server");
  test.beforeEach(async () => {
    await resetFixtures();
  });

  test("IMP-02 keep an App Store import in sync: listed with its schedule, run now, pause and stop; a saved-page source can't be synced", async ({ page, baseURL }) => {
    await fixtureRespond({ path: FEED(1), headers: { "content-type": "application/json" }, body: fs.readFileSync(path.join(ROOT, "importers", "appstore", "page1.json"), "utf8") });
    await fixtureRespond({ path: FEED(2), headers: { "content-type": "application/json" }, body: fs.readFileSync(path.join(ROOT, "importers", "appstore", "page2.json"), "utf8") });
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Sync Co", slug("sync"));
    await signIn(page);
    await page.goto(`/admin/projects/${p.id}/data`);

    await page.getByTestId("import-source-appstore").click();
    const wizard = page.getByTestId("import-wizard");
    await wizard.getByLabel("App Store link or app ID").fill("https://apps.apple.com/us/app/acme/id123456789");
    await wizard.getByTestId("import-ownership").click();
    await wizard.getByTestId("import-preview-button").click();
    await expect(wizard.getByTestId("import-item")).toHaveCount(50);
    await wizard.getByTestId("import-all").click();
    await expect(wizard.getByTestId("import-summary")).toHaveText("60 new, 0 already imported", { timeout: 30_000 });

    await wizard.getByTestId("import-sync-interval").selectOption("12");
    await wizard.getByTestId("import-sync").click();
    await expect(wizard.getByTestId("import-synced")).toContainText("every 12 hours");
    const row = page.getByTestId("synced-source");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("App Store");
    await expect(row).toContainText("123456789 · us");
    await expect(row).toContainText("every 12 h · 0 added");

    // Run now: a sync run that finds nothing new adds nothing (the dedupe key).
    await row.getByTestId("synced-run").click();
    await expect(row.getByTestId("synced-last")).toContainText("worked", { timeout: 30_000 });
    await expect(row).toContainText("0 added");
    const total = (await (await api.get(`/api/admin/projects/${p.id}/testimonials?tab=all&size=25`)).json()).total;
    expect(total).toBe(60);

    await row.getByTestId("synced-pause").click();
    await expect(row).toHaveAttribute("data-status", "paused");
    await expect(row).toContainText("Paused");
    await row.getByTestId("synced-pause").click();
    await expect(row).not.toHaveAttribute("data-status", "paused");

    page.once("dialog", (d) => void d.accept());
    await row.getByTestId("synced-delete").click();
    await expect(page.getByTestId("synced-source")).toHaveCount(0);

    // A source that only takes a saved page never offers sync.
    await page.getByTestId("import-source-yelp").click();
    await expect(page.getByTestId("import-saved-only")).toBeVisible();
    await expect(page.getByTestId("import-preview-button")).toHaveCount(0);
    await page.getByTestId("import-ownership").click();
    await page.getByTestId("import-html-file").setInputFiles({ name: "yelp.html", mimeType: "text/html", buffer: fs.readFileSync(path.join(ROOT, "importers", "yelp", "saved.html")) });
    await expect(page.getByTestId("import-item")).toHaveCount(2);
    await page.getByTestId("import-all").click();
    await expect(page.getByTestId("import-summary")).toHaveText("2 new, 0 already imported", { timeout: 20_000 });
    await expect(page.getByTestId("import-keep-sync")).toHaveCount(0);
  });
});

test("INBOX-11 possible duplicates are flagged and Merge into… keeps both answers, trashing the second", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Dupes Co", slug("dupes"));
  const [first, second] = await seed(api, p.slug, [
    { name: "Ada Lovelace", email: "ada@example.com", text: "The first thing Ada wrote.", status: "approved" },
    { name: "Ada L.", email: "ada@example.com", text: "Ada again, a month later.", tags: ["later"] },
    { name: "Grace Hopper", email: "grace@example.com", text: "Something else entirely." },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?tab=all&dupes=1`);
  await expect(page.getByTestId("active-filters")).toContainText("Possible duplicates");
  await expect(page.locator(".ib-queue").getByText("Something else entirely.")).toHaveCount(0);

  await page.goto(`/admin/projects/${p.id}?tab=all&open=${second}`);
  const drawer = page.getByTestId("detail-drawer");
  await expect(drawer.getByTestId("duplicate-notice")).toContainText("Possible duplicate of Ada Lovelace");
  await drawer.getByTestId("merge-open").click();
  const dialog = page.getByTestId("merge-dialog");
  await expect(dialog.getByTestId("merge-candidate")).toHaveCount(1);
  await dialog.getByTestId("merge-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(drawer.getByTestId("detail-status")).toHaveText("In the trash");
  await expect(drawer.getByTestId("merged-notice")).toContainText("Merged into Ada Lovelace’s testimonial");

  await page.goto(`/admin/projects/${p.id}?tab=all&open=${first}`);
  await expect(drawer.getByTestId("history")).toContainText("Merged");
  await expect(drawer).toContainText("Ada again, a month later.");
  const detail = await (await api.get(`/api/admin/testimonials/${first}/detail`)).json();
  expect(detail.testimonial.tags).toEqual(["later"]);
  expect(detail.answers.map((a: { text: string }) => a.text)).toEqual(["Ada again, a month later."]);
  // Still the same public words.
  const feed = await (await api.get(`/api/widget/${p.slug}`)).json();
  expect(feed.testimonials.map((t: { text: string }) => t.text)).toEqual(["The first thing Ada wrote."]);
});

test("INBOX-12 a customer's record: listed and searchable, a profile with their testimonials, edit, invite to a form and add a testimonial", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "People Co", slug("people"));
  await seed(api, p.slug, [
    { name: "Mia Chen", email: "mia@example.com", text: "Mia's first words.", rating: 5 },
    { name: "Mia Chen", email: "mia@example.com", text: "Mia's second words." },
    { name: "Omar Diaz", email: "omar@example.com", text: "Omar's words." },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/customers`);
  const rows = page.getByTestId("customer-row");
  await expect(rows).toHaveCount(2);
  await page.getByTestId("customers-search").getByRole("searchbox").fill("mia@");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByTestId("customer-testimonials")).toHaveText("2");
  await rows.first().getByRole("link", { name: "Mia Chen" }).click();

  const profile = page.getByTestId("customer-profile");
  await expect(profile.getByTestId("customer-testimonial")).toHaveCount(2);
  await profile.getByTestId("customer-edit").click();
  const edit = page.getByTestId("customer-edit-dialog");
  await edit.getByLabel("Company").fill("Chen Studio");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(profile).toContainText("Chen Studio");

  await profile.getByTestId("customer-invite").click();
  const invite = page.getByTestId("customer-invite-dialog");
  await invite.getByRole("checkbox").uncheck();
  await invite.getByTestId("customer-invite-send").click();
  await expect(invite.getByTestId("customer-invite-link").locator("input")).toHaveValue(new RegExp(`/c/${p.slug}\\?r=`));
  await invite.getByRole("button", { name: "Done" }).click();
  await expect(profile.getByTestId("customer-invite-row")).toHaveCount(1);

  await profile.getByTestId("manual-add-open").click();
  const add = page.getByTestId("manual-add");
  await expect(add.getByLabel("Email (private)")).toHaveValue("mia@example.com");
  await add.getByLabel("Testimonial text").fill("Told us on a call.");
  await add.getByRole("button", { name: "Add testimonial" }).click();
  await expect(profile.getByTestId("customer-testimonial")).toHaveCount(3);
});

test("INBOX-13 a translation added in the drawer shows in a widget for a visitor whose browser asks for that language", async ({ page, browser, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Lingo Co", slug("lingo"));
  const [id] = await seed(api, p.slug, [{ name: "Ana", text: "Shipping was fast.", status: "approved" }]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?tab=all&open=${id}`);
  const panel = page.getByTestId("detail-drawer").getByTestId("translations");
  await panel.getByTestId("translation-add").click();
  await panel.getByTestId("translation-lang").fill("fr");
  await panel.getByTestId("translation-text").fill("La livraison était rapide.");
  await panel.getByTestId("translation-save").click();
  await expect(panel.getByTestId("translation")).toHaveAttribute("data-lang", "fr");
  await expect(panel).toContainText("La livraison était rapide.");

  const w = (await (await api.post(`/api/admin/projects/${p.id}/widgets`, { data: { name: `Lingo ${RUN}`, layout: "grid", config: { design: { translations: "visitor" } } } })).json()).widget as { id: string };
  const french = await browser.newContext({ locale: "fr-FR" });
  const visitor = await french.newPage();
  await visitor.goto(`${baseURL}/embed/${w.id}`);
  await expect(visitor.locator(`[data-plaudit-widget="${w.id}"]`)).toContainText("La livraison était rapide.", { timeout: 15_000 });
  await french.close();
  const english = await browser.newContext({ locale: "en-GB" });
  const other = await english.newPage();
  await other.goto(`${baseURL}/embed/${w.id}`);
  await expect(other.locator(`[data-plaudit-widget="${w.id}"]`)).toContainText("Shipping was fast.", { timeout: 15_000 });
  await english.close();
});

test("INBOX-14 smart search without a provider falls back to keyword search and says so", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Search Co", slug("search"));
  await seed(api, p.slug, [
    { name: "Kai", text: "Support answered within minutes." },
    { name: "Lu", text: "Pricing is fair." },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?tab=all`);
  await page.getByTestId("smart-search").getByRole("switch").check();
  await page.getByTestId("inbox-search").getByRole("searchbox").fill("support");
  await expect(page.getByTestId("search-mode")).toHaveAttribute("data-mode", "keyword", { timeout: 10_000 });
  await expect(page.getByTestId("search-mode")).toContainText("isn’t set up on this server");
  await expect(page.locator(".ib-queue")).toContainText("Support answered within minutes.");
  await expect(page.locator(".ib-queue")).not.toContainText("Pricing is fair.");
});

test.describe("phones", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("INBOX-12 IMP-02 the customers list, a profile and the import page fit 360 px", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Small Co", slug("small"));
    await seed(api, p.slug, [{ name: "Noor Haddad-Longname", email: "noor.with.a.very.long.address@example.com", text: "Hello from a phone." }]);
    await signIn(page);
    for (const url of [`/admin/projects/${p.id}/customers`, `/admin/projects/${p.id}/data`]) {
      await page.goto(url);
      await expect(page.locator("main")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    }
    await page.goto(`/admin/projects/${p.id}/customers`);
    await page.getByTestId("customer-row").first().getByRole("link").click();
    await expect(page.getByTestId("customer-profile")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
