import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminApi, createProject, FIXTURES, signIn, useFreshIp } from "./helpers";

/** Adding testimonials by hand (PRD §8.1): text, a screenshot and a video. */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("IMP-8.1 adds a text testimonial and a screenshot testimonial by hand", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Manual Co", `manual-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);

  await page.getByTestId("manual-add-open").click();
  const modal = page.getByTestId("manual-add");
  await modal.getByLabel("Name", { exact: true }).fill("Tess Text");
  await modal.getByLabel("Company", { exact: true }).fill("Initech");
  await modal.getByLabel("Rating").selectOption("5");
  await modal.getByLabel("Testimonial text").fill("Told us by email: best support we've had.");
  await modal.getByLabel("Where it was posted").selectOption("email");
  await modal.getByLabel("Tags (comma separated)").fill("Email, support");
  await modal.getByRole("button", { name: "Add testimonial" }).click();
  await expect(modal).toBeHidden();

  // Approved by default: it's in Approved, and on the wall.
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Approved/ }).click();
  const tess = page.getByTestId("admin-testimonial").filter({ hasText: "Tess Text" });
  await expect(tess).toHaveAttribute("data-status", "approved");
  await expect(tess.getByLabel(/^Tags/)).toHaveValue("email, support");
  await tess.getByTestId("consent-panel").locator("summary").click();
  await expect(tess.getByTestId("consent-panel")).toContainText("consent was collected outside Plaudit");

  // A screenshot, kept pending.
  await page.getByTestId("manual-add-open").click();
  await modal.getByTestId("manual-kind").getByRole("button", { name: "Image" }).click();
  await modal.getByLabel("Name", { exact: true }).fill("Sam Screenshot");
  await modal.getByTestId("manual-images").setInputFiles(path.join(FIXTURES, "avatar.png"));
  await modal.getByLabel("Status").selectOption("pending");
  await modal.getByRole("button", { name: "Add testimonial" }).click();
  await expect(modal).toBeHidden();
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Pending/ }).click();
  const sam = page.getByTestId("admin-testimonial").filter({ hasText: "Sam Screenshot" });
  await sam.getByRole("button", { name: "Details" }).click();
  const drawer = page.getByTestId("detail-drawer");
  await expect(drawer.getByRole("img", { name: "Attached image" })).toHaveCount(1);
  await expect(drawer.getByTestId("detail-source")).toContainText("Added by hand");
  // Not public until it's approved.
  const src = await drawer.getByRole("img", { name: "Attached image" }).getAttribute("src");
  const anon = await page.context().browser()!.newContext();
  expect((await anon.request.get(`${baseURL}${src}`)).status()).toBe(404);
  await page.keyboard.press("a");
  await expect(drawer.getByTestId("detail-status")).toHaveText("Approved");
  expect((await anon.request.get(`${baseURL}${src}`)).status()).toBe(200);
  await anon.close();

  // The name is required.
  await page.keyboard.press("Escape");
  await page.getByTestId("manual-add-open").click();
  await modal.getByTestId("manual-kind").getByRole("button", { name: "Image" }).click();
  await modal.getByRole("button", { name: "Add testimonial" }).click();
  await expect(modal).toBeVisible();
});

test("IMP-8.1 adds a video testimonial, which goes through the usual processing", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Manual Video Co", `manual-video-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByTestId("manual-add-open").click();
  const modal = page.getByTestId("manual-add");
  await modal.getByTestId("manual-kind").getByRole("button", { name: "Video" }).click();
  await modal.getByLabel("Name", { exact: true }).fill("Vic Video");
  await modal.getByTestId("manual-video").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await modal.getByRole("button", { name: "Add testimonial" }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Approved/ }).click();
  const vic = page.getByTestId("admin-testimonial").filter({ hasText: "Vic Video" });
  await expect(vic.locator("video")).toBeVisible();
  const list = await (await api.get(`/api/admin/projects/${p.id}/testimonials?tab=approved`)).json();
  expect(list.items[0]).toMatchObject({ source: "manual", authorName: "Vic Video" });
  expect(list.items[0].videoKey).toMatch(/^videos\//);
});
