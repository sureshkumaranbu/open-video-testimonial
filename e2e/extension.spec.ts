import fs from "node:fs";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { adminApi, createProject, hostPage, signIn, startHostServer } from "./helpers";

/**
 * EXT-01: the browser extension, loaded unpacked into Chromium (extensions
 * load only there: WebKit is skipped). It's set up on its options page with a
 * key limited to one project, then a selection on another site is saved
 * through the review window, from the extension's own origin (so /api/v1's
 * CORS for extensions is what lets it through), and found in the inbox.
 *
 * A test can't click a browser's context menu, so it runs the same two steps
 * the menu item does: the extension's capture.js on the page, then the
 * background worker's openReview with what it read.
 */

const EXTENSION = path.resolve(__dirname, "..", "extension");
const RUN = Date.now().toString(36);

test.skip(({ browserName }) => browserName !== "chromium", "browser extensions load only in Chromium");

test("EXT-01 the extension saves a selection from another site, with its author, as a pending testimonial in the inbox", async ({ page, baseURL }, testInfo) => {
  // A browser of its own with the extension, on top of the test's usual one.
  test.setTimeout(120_000);
  const api = await adminApi(baseURL!);
  const project = await createProject(api, "Extension Co", `extension-co-${RUN}`);
  const made = await api.post("/api/admin/api-keys", { data: { name: `extension-${RUN}`, scope: "write", projectIds: [project.id] } });
  expect(made.status(), await made.text()).toBe(201);
  const key = (await made.json()).key as string;

  const profile = testInfo.outputPath("extension-profile");
  fs.rmSync(profile, { recursive: true, force: true });
  const browser = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  const host = await startHostServer();
  try {
    let [worker] = browser.serviceWorkers();
    worker ??= await browser.waitForEvent("serviceworker", { timeout: 15_000 });
    const extensionId = new URL(worker.url()).host;

    // Options: the address, the key and the one project it reaches.
    const options = await browser.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByLabel("Your Plaudit address").fill(baseURL!);
    await options.getByLabel("API key").fill(key);
    await options.getByRole("button", { name: "Find my projects" }).click();
    await expect(options.getByRole("status")).toHaveText("This key reaches 1 project.");
    await expect(options.getByLabel("Save to the project")).toHaveValue(project.slug);
    await options.getByRole("button", { name: "Save" }).click();
    await expect(options.getByRole("status")).toContainText("Saved.");

    // A page on another site, with a quote and its author's tag.
    host.pages["/reviews"] = hostPage("Reviews", `<blockquote><p id="quote">Plaudit turned our happy customers into a wall of love in an afternoon.</p></blockquote>`).replace(
      "<head>",
      '<head><meta name="author" content="Morgan Reed">',
    );
    const site = await browser.newPage();
    await site.goto(`${host.url}/reviews`);
    await site.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("quote")!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await site.addScriptTag({ path: path.join(EXTENSION, "capture.js") });
    const capture = await site.evaluate(() => (globalThis as unknown as { plauditCapture: (d: Document) => unknown }).plauditCapture(document));

    const opened = browser.waitForEvent("page", { timeout: 15_000 });
    await worker.evaluate((c) => (globalThis as unknown as { plauditOpenReview: (c: unknown) => Promise<void> }).plauditOpenReview(c), capture);
    const review = await opened;
    await review.waitForLoadState();
    await expect(review.getByLabel("Their words")).toHaveValue("Plaudit turned our happy customers into a wall of love in an afternoon.");
    await expect(review.getByLabel("Name")).toHaveValue("Morgan Reed");
    await expect(review.getByRole("link", { name: "Reviews" })).toHaveAttribute("href", `${host.url}/reviews`);
    // Nothing is sent until the author's agreement is confirmed.
    await review.getByRole("button", { name: "Save to Plaudit" }).click();
    await expect(review.getByLabel(/The author agreed to be quoted/)).toBeFocused();
    await review.getByLabel(/The author agreed to be quoted/).check();
    await review.getByRole("button", { name: "Save to Plaudit" }).click();
    await expect(review.getByRole("status")).toHaveText("Saved. It's in your Plaudit inbox as Pending.");
  } finally {
    // The browser first: the page server waits for its open connections to end.
    await browser.close().catch(() => {});
    await host.close();
  }

  await signIn(page);
  await page.goto(`/admin/projects/${project.id}`);
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Morgan Reed" });
  await expect(card).toContainText("Plaudit turned our happy customers into a wall of love");
  const list = await (await api.get(`/api/admin/projects/${project.id}/testimonials`)).json();
  expect(JSON.stringify(list)).toContain('"status":"pending"');
});
