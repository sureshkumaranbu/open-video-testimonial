import { expect, test, type Page } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/**
 * Inbox v2 (M3): tabs, filters in the URL, the remembered sort, pages, bulk
 * actions, the detail drawer and its keys, editing every answer, highlights,
 * the trash and the filtered export. The classic card controls are covered
 * by the older dashboard specs, which run against this same inbox.
 */

const RUN = Date.now().toString(36);
const slug = (s: string) => `${s}-${RUN}`;

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

const tabs = (page: Page) => page.getByRole("group", { name: "Filter by status" });
const tab = (page: Page, label: string) => tabs(page).getByRole("button", { name: new RegExp(`^${label}`) });
const count = (page: Page, label: string) => tab(page, label).locator(".count");
const card = (page: Page, name: string) => page.getByTestId("admin-testimonial").filter({ hasText: name });

test("INBOX-01 seven tabs with counts sit in a 4×2 grid at 375 px", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Tabs Co", slug("tabs"));
  await seed(api, p.slug, [
    { name: "Tab Pending", text: "One" },
    { name: "Tab Approved", text: "Two", status: "approved" },
  ]);
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  const labels = ["All", "Pending", "Approved", "Hidden", "Rejected", "Feedback", "Trash"];
  const boxes = [];
  for (const label of labels) {
    const box = (await tab(page, label).boundingBox())!;
    expect(box.x, label).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, label).toBeLessThanOrEqual(375);
    boxes.push(box);
  }
  // Two rows: the first four share a line, the last three the next one.
  expect(new Set(boxes.slice(0, 4).map((b) => Math.round(b.y))).size).toBe(1);
  expect(new Set(boxes.slice(4).map((b) => Math.round(b.y))).size).toBe(1);
  expect(boxes[4].y).toBeGreaterThan(boxes[0].y);
  await expect(count(page, "All")).toHaveText("2");
  await expect(count(page, "Pending")).toHaveText("1");
  // Pending is still where it opens.
  await expect(tab(page, "Pending")).toHaveAttribute("aria-pressed", "true");
});

test("INBOX-03 INBOX-04 filters and sort go into the URL; a new tab opens the same view, and the sort is remembered", async ({ page, baseURL, context }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Filter Co", slug("filter"));
  await seed(api, p.slug, [
    { name: "Five Video", text: "Five stars with video", rating: 5, video: true, tags: ["pricing"], status: "approved" },
    { name: "Four Video", text: "Four stars with video", rating: 4, video: true, tags: ["pricing"], status: "approved" },
    { name: "Four Text", text: "Four stars, text only", rating: 4, tags: ["pricing"], status: "approved" },
    { name: "Three Video", text: "Three stars with video", rating: 3, video: true, tags: ["pricing"], status: "approved" },
    { name: "Five Untagged", text: "No tag here", rating: 5, video: true, status: "approved" },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?tab=all`);
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(5);

  await page.getByTestId("filters-toggle").click();
  const panel = page.getByTestId("filter-panel");
  await panel.getByTestId("filter-rating").getByRole("button", { name: "4★" }).click();
  await panel.getByTestId("filter-rating").getByRole("button", { name: "5★" }).click();
  await panel.getByTestId("filter-tags").getByRole("button", { name: "pricing" }).click();
  await panel.getByTestId("filter-type").selectOption("video");
  await page.getByTestId("inbox-sort").selectOption("rating");
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(2);
  await expect(page.getByTestId("admin-testimonial").first()).toContainText("Five Video");
  await expect(page).toHaveURL(/rating=4%2C5|rating=4,5/);
  await expect(page).toHaveURL(/tag=pricing/);
  await expect(page).toHaveURL(/type=video/);

  // The same address in a new tab shows the same view.
  const copy = await context.newPage();
  await useFreshIp(copy);
  await copy.goto(page.url());
  const rows = copy.getByTestId("admin-testimonial");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Five Video");
  await expect(rows.nth(1)).toContainText("Four Video");
  await expect(copy.getByTestId("active-filters")).toContainText("Rating: 4★, 5★");
  await copy.close();

  // The sort is remembered for next time, without anything in the URL.
  await page.goto(`/admin/projects/${p.id}?tab=all`);
  await expect(page.getByTestId("inbox-sort")).toHaveValue("rating");
  await expect(page.getByTestId("admin-testimonial").nth(2)).toContainText(/Four/);
  // Put it back for the other specs.
  await page.getByTestId("inbox-sort").selectOption("created");
  await expect(page.getByTestId("inbox-sort")).toHaveValue("created");
  await expect.poll(async () => (await (await api.get("/api/admin/me/prefs")).json()).ui.inboxSort).toBe("created");
});

test("INBOX-05 INBOX-06 pages on the server, then bulk-hides three", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Pager Co", slug("pager"));
  await seed(
    api,
    p.slug,
    Array.from({ length: 28 }, (_, i) => ({ name: `Paged ${String(i).padStart(2, "0")}`, text: `Number ${i}` })),
  );
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(25);
  const pager = page.getByTestId("inbox-pager");
  await expect(pager).toContainText("of 28");
  await pager.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(3);
  await expect(page).toHaveURL(/page=2/);
  await pager.getByRole("button", { name: "Previous page" }).click();
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(25);

  // The bulk bar only shows once something is selected.
  await expect(page.getByTestId("bulk-bar").getByRole("toolbar")).toHaveCount(0);
  for (const n of ["27", "26", "25"]) await card(page, `Paged ${n}`).getByLabel(`Select Paged ${n}`).check();
  const bar = page.getByTestId("bulk-bar");
  await expect(bar).toContainText("3 testimonials selected");
  await bar.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByTestId("bulk-result")).toContainText("3 hidden");
  await expect(count(page, "Hidden")).toHaveText("3");
  await expect(count(page, "Pending")).toHaveText("25");
  await tab(page, "Hidden").click();
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(3);
  await expect(page.getByTestId("admin-testimonial").first()).toHaveAttribute("data-status", "hidden");
});

test("INBOX-06 a bulk action skips rows it doesn't apply to and says why", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Bulk Co", slug("bulk"));
  await seed(api, p.slug, [
    { name: "Bulk One", text: "One" },
    { name: "Bulk Two", text: "Two" },
    { name: "Bulk Gone", text: "Three", status: "rejected" },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?tab=all`);
  await page.getByTestId("select-page").getByRole("checkbox").check();
  await expect(page.getByTestId("bulk-bar")).toContainText("3 testimonials selected");
  await page.getByTestId("bulk-bar").getByRole("button", { name: "Reject" }).click();
  await expect(page.getByTestId("bulk-result")).toContainText("2 rejected, 1 skipped");
  await expect(page.getByTestId("bulk-skipped")).toContainText("Bulk Gone: Already rejected");
  await expect(count(page, "Rejected")).toHaveText("3");
});

test("INBOX-07 the drawer opens from a row, and j, k, a and h work", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Drawer Co", slug("drawer"));
  await seed(api, p.slug, [
    { name: "Drawer Third", text: "Third" },
    { name: "Drawer Second", text: "Second" },
    { name: "Drawer First", text: "First" },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?tab=all`);
  await card(page, "Drawer First").getByRole("button", { name: "Details" }).click();
  const drawer = page.getByTestId("detail-drawer");
  await expect(drawer.getByRole("heading", { name: "Drawer First" })).toBeVisible();
  await page.keyboard.press("j");
  await expect(drawer.getByRole("heading", { name: "Drawer Second" })).toBeVisible();
  await page.keyboard.press("j");
  await expect(drawer.getByRole("heading", { name: "Drawer Third" })).toBeVisible();
  await page.keyboard.press("k");
  await expect(drawer.getByRole("heading", { name: "Drawer Second" })).toBeVisible();
  await page.keyboard.press("a");
  await expect(drawer.getByTestId("detail-status")).toHaveText("Approved");
  await page.keyboard.press("h");
  await expect(drawer.getByTestId("detail-status")).toHaveText("Hidden");
  await expect(drawer.getByTestId("history")).toContainText("Approved → Hidden");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(card(page, "Drawer Second")).toHaveAttribute("data-status", "hidden");
  await expect(count(page, "Hidden")).toHaveText("1");
});

test("INBOX-08 INBOX-10 edits every answer: the edited-after-consent badge and the history show it; a phrase is highlighted", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project } = await formProject(api, "Edit Answers Co", {
    pages: [
      { type: "rating" },
      { type: "question", key: "q1", primary: true, title: "What changed?", mode: "text" },
      { type: "question", key: "q2", title: "What almost stopped you?", mode: "text", required: false },
      { type: "consent" },
      { type: "about_you" },
      { type: "thank_you" },
    ],
  });
  await seed(api, project.slug, [{ name: "Eddie Edit", rating: 5, formSlug: "stories", answers: { q1: "We ship weekly now.", q2: "The price, at first." } }]);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}`);
  await card(page, "Eddie Edit").getByRole("button", { name: "Details" }).click();
  const drawer = page.getByTestId("detail-drawer");
  await expect(drawer.getByTestId("edited-badge")).toHaveCount(0);

  await drawer.getByTestId("edit-toggle").click();
  const form = drawer.getByTestId("edit-form");
  await form.getByLabel("Answer to “What almost stopped you?”").fill("Only the price, at first.");
  await form.getByLabel("Job title").fill("Head of product");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(drawer.getByTestId("edited-badge")).toBeVisible();
  await expect(drawer.getByTestId("highlight-editor")).toContainText("Only the price, at first.");
  const history = drawer.getByTestId("history");
  await expect(history.locator("li[data-action=answer_edited]")).toContainText("answer q2");
  await expect(history.locator("li[data-action=edited]")).toContainText("job title");
  await expect(history).toContainText("owner@example.com");

  // Select "ship weekly" in the main answer and highlight it.
  const main = drawer.locator('[data-hl-block="main"]');
  await main.evaluate((el) => {
    const node = el.firstChild!;
    const text = node.textContent!;
    const start = text.indexOf("ship weekly");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + "ship weekly".length);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await expect(drawer).toContainText("Selected: “ship weekly”");
  await drawer.getByTestId("highlight-button").click();
  await expect(main.locator("mark")).toHaveText("ship weekly");
  await expect(drawer.getByTestId("highlight-list")).toContainText("ship weekly");
  await expect(history.locator("li[data-action=highlights]")).toHaveCount(1);
  // And off again.
  await drawer.getByRole("button", { name: "Remove highlight “ship weekly”" }).click();
  await expect(main.locator("mark")).toHaveCount(0);
});

test("INBOX-09 trash and restore: Delete moves to the trash, Restore brings back the status and media", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Trash Co", slug("trash"));
  await seed(api, p.slug, [
    { name: "Trash Video", text: "With a video", video: true, status: "approved" },
    { name: "Trash Keep", text: "Stays" },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?tab=approved`);
  page.once("dialog", (d) => d.accept());
  await card(page, "Trash Video").getByRole("button", { name: "Delete" }).click();
  await expect(card(page, "Trash Video")).toHaveCount(0);
  await expect(count(page, "Trash")).toHaveText("1");
  await expect(count(page, "All")).toHaveText("1");

  await tab(page, "Trash").click();
  const trashed = card(page, "Trash Video");
  await expect(trashed).toHaveAttribute("data-status", "trashed");
  await expect(trashed.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await trashed.getByRole("button", { name: "Restore" }).click();
  await expect(count(page, "Trash")).toHaveText("0");
  await tab(page, "Approved").click();
  const back = card(page, "Trash Video");
  await expect(back).toHaveAttribute("data-status", "approved");
  await expect(back.locator("video")).toBeVisible();
  // Its video is public again.
  const src = await back.locator("video source").first().getAttribute("src");
  expect((await page.request.get(src!)).status()).toBe(200);

  // Deleting for good is offered only from the trash.
  page.once("dialog", (d) => d.accept());
  await card(page, "Trash Video").getByRole("button", { name: "Delete" }).click();
  await tab(page, "Trash").click();
  page.once("dialog", (d) => d.accept());
  await card(page, "Trash Video").getByRole("button", { name: "Delete forever" }).click();
  await expect(card(page, "Trash Video")).toHaveCount(0);
  await expect(count(page, "Trash")).toHaveText("0");
  expect((await page.request.get(src!)).status()).toBe(404);
});

test("INBOX-15 exports the filtered view as CSV with custom fields", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project } = await formProject(api, "Export View Co", {
    pages: [
      { type: "rating" },
      { type: "question", key: "q1", primary: true, title: "What changed?", mode: "text" },
      { type: "consent" },
      { type: "about_you", custom: [{ key: "nps", type: "nps", label: "NPS" }] },
      { type: "thank_you" },
    ],
  });
  await seed(api, project.slug, [
    { name: "Export Five", rating: 5, formSlug: "stories", answers: { q1: "Great" }, customFields: { nps: 10 } },
    { name: "Export Two", rating: 2, formSlug: "stories", answers: { q1: "Meh" }, customFields: { nps: 3 } },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}?tab=all&rating=5`);
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(1);
  await page.locator(".ib-export > summary").click();
  const href = await page.getByTestId("export-csv").getAttribute("href");
  expect(href).toContain("rating=5");
  const download = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const res = await page.request.get(href!);
  const csv = await res.text();
  const [head, ...rows] = csv.trim().split("\r\n");
  expect(head.split(",")).toContain("custom:nps");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toContain("Export Five");
  expect(rows[0]).toContain(",10");
});

test("INBOX-01 table view: the choice is remembered, and Details opens the drawer", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Table Co", slug("table"));
  await seed(api, p.slug, [{ name: "Tabby Table", text: "A dense line", rating: 4, tags: ["home"] }]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByTestId("inbox-view").getByRole("button", { name: "Table" }).click();
  const row = page.getByTestId("inbox-row").filter({ hasText: "Tabby Table" });
  await expect(row).toContainText("A dense line");
  await expect(row).toContainText("Form");
  await expect.poll(async () => (await (await api.get("/api/admin/me/prefs")).json()).ui.inboxView).toBe("table");
  await page.reload();
  await expect(page.getByTestId("inbox-table")).toBeVisible();
  await row.getByRole("button", { name: "Details for Tabby Table" }).click();
  await expect(page.getByTestId("detail-drawer").getByRole("heading", { name: "Tabby Table" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Back to cards, which the other specs expect.
  await page.getByTestId("inbox-view").getByRole("button", { name: "Cards" }).click();
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(1);
  await expect.poll(async () => (await (await api.get("/api/admin/me/prefs")).json()).ui.inboxView).toBe("card");
});
