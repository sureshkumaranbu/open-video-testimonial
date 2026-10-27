import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { adminApi, createProject, signIn, useFreshIp } from "./helpers";

/**
 * The form builder (FORM-01, 02, 08, 10, 11, 18): a form from a template,
 * reordering and adding questions, the live preview matching the public page,
 * the unsaved-changes guard (only when something changed), the share panel
 * with QR downloads, and switching a classic form to step by step.
 */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

const pageList = (page: Page) => page.getByTestId("page-list");

/** The runner's look, read from the element: what the preview and the public page must share. */
const look = (page: Page, scope: string) =>
  page.locator(`${scope} [data-testid=form-runner]`).first().evaluate((root) => {
    const s = getComputedStyle(root);
    const button = root.querySelector("button.fr-primary");
    const h1 = root.querySelector("h1");
    return {
      primary: s.getPropertyValue("--fr-primary").trim(),
      background: s.backgroundColor,
      radius: s.getPropertyValue("--fr-radius").trim(),
      theme: root.getAttribute("data-theme"),
      buttonBg: button ? getComputedStyle(button).backgroundColor : null,
      heading: h1 ? getComputedStyle(h1).fontFamily : null,
      headingText: h1?.textContent,
    };
  });

test("FORM-18 FORM-02 builds a form from a template: reorder, add a video-only question, design, save", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, "Builder Co", `builder-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms`);
  await page.getByLabel("New form name").fill("SaaS stories");
  await page.getByLabel("Start from").selectOption("saas");
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("form-builder")).toBeVisible();

  // Nothing changed yet: leaving doesn't ask.
  let asked = 0;
  page.on("dialog", (d) => {
    asked++;
    void d.dismiss();
  });
  await expect(page.getByTestId("save-form")).toHaveText("Saved");

  // Reorder: move the second question above the first.
  const titles = () => pageList(page).locator("li[data-type=question] .fb-page-title").allTextContents();
  const before = await titles();
  expect(before).toHaveLength(2);
  await page.getByRole("button", { name: `Move ${before[1]} up` }).click();
  expect(await titles()).toEqual([before[1], before[0]]);
  await page.getByRole("button", { name: `Move ${before[1]} down` }).click();
  expect(await titles()).toEqual(before);

  // Add Q3, video only; the preview follows at once.
  await page.getByRole("button", { name: "Add question" }).click();
  const editor = page.getByTestId("page-editor");
  await editor.getByLabel("Question", { exact: true }).fill("Say hi on camera");
  await editor.getByTestId("question-mode").selectOption("video");
  await expect(page.getByTestId("form-preview").getByRole("heading", { name: /Say hi on camera/ })).toBeVisible();
  await expect(page.getByTestId("form-preview").getByTestId("video-placeholder")).toBeVisible();
  await expect(page.getByTestId("save-form")).toHaveText("Save changes");

  // Something changed: an in-app link now asks first (and staying keeps the page).
  await page.getByRole("link", { name: "Forms", exact: true }).first().click();
  expect(asked).toBe(1);
  await expect(page.getByTestId("form-builder")).toBeVisible();

  // Design: a primary colour and the dark theme, previewed straight away.
  await page.getByRole("tab", { name: "Design" }).click();
  await page.getByTestId("color-primary").locator("input[type=text]").fill("#0a7f5a");
  await page.getByTestId("theme").getByRole("button", { name: "Dark" }).click();
  await page.getByTestId("save-form").click();
  await expect(page.getByTestId("save-form")).toHaveText("Saved");

  // The public page has the same look as the preview, page for page.
  await page.getByRole("tab", { name: "Content" }).click();
  await pageList(page).locator("li[data-type=rating] .fb-page-pick").click();
  const preview = await look(page, "[data-testid=form-preview]");
  expect(preview.primary).toBe("#0a7f5a");
  expect(preview.theme).toBe("dark");
  const builderUrl = page.url();
  const forms = (await (await api.get(`/api/admin/projects/${project.id}/forms`)).json()).forms;
  const made = forms.find((f: { name: string }) => f.name === "SaaS stories");
  const pub = await page.context().newPage();
  await pub.setViewportSize({ width: 375, height: 800 });
  await pub.goto(made.links.hosted);
  expect(await look(pub, "body")).toEqual(preview);
  await pub.close();

  // Nothing unsaved now: leaving doesn't ask.
  await page.goto(builderUrl);
  await page.getByRole("link", { name: "Forms", exact: true }).first().click();
  await expect(page).toHaveURL(/\/forms$/);
  expect(asked).toBe(1);
  await expect(page.getByTestId("form-card").filter({ hasText: "SaaS stories" })).toBeVisible();
});

test("FORM-08 L5 a white button on a white page, and white text on it, get contrast warnings (saving still works)", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, "Contrast Co", `contrast-${RUN}`);
  const form = (await (await api.post(`/api/admin/projects/${project.id}/forms`, { data: { name: "Stories", slug: "stories" } })).json()).form;
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms/${form.id}`);
  await page.getByRole("tab", { name: "Design" }).click();
  const button = page.getByTestId("color-button");
  const buttonText = page.getByTestId("color-buttonText");
  await expect(page.getByTestId("design-editor").getByText(/Low contrast/)).toHaveCount(0);

  await button.locator("input[type=text]").fill("#ffffff");
  await expect(button.getByText(/Low contrast \(1\.0:1\).*at least 3:1/)).toBeVisible();
  // Left empty, the button text follows the button and stays readable.
  await expect(buttonText.getByText(/Low contrast/)).toHaveCount(0);
  await buttonText.locator("input[type=text]").fill("#ffffff");
  await expect(buttonText.getByText(/Low contrast \(1\.0:1\).*at least 4\.5:1/)).toBeVisible();
  // The hex box points at the warning for screen readers.
  const warnId = await buttonText.locator(".ak-field-warn").getAttribute("id");
  await expect(buttonText.locator("input[type=text]")).toHaveAttribute("aria-describedby", new RegExp(warnId!));

  // A warning, not a block.
  await page.getByTestId("save-form").click();
  await expect(page.getByTestId("save-form")).toHaveText("Saved");
  await buttonText.locator("input[type=text]").fill("#161b2e");
  await expect(buttonText.getByText(/Low contrast/)).toHaveCount(0);
  await expect(button.getByText(/Low contrast/)).toBeVisible();
});

test("FORM-11 share panel: copy the link, QR as PNG and SVG, the three embed snippets", async ({ page, baseURL, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const api = await adminApi(baseURL!);
  const project = await createProject(api, "Share Co", `share-${RUN}`);
  const form = (await (await api.post(`/api/admin/projects/${project.id}/forms`, { data: { name: "Stories", slug: "stories" } })).json()).form;
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms/${form.id}?tab=share`);
  const panel = page.getByTestId("share-panel");
  await panel.getByTestId("share-link").getByRole("button", { name: "Copy" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(form.links.hosted);
  await expect(panel.getByTestId("embed-inline")).toContainText('data-plaudit-form="stories"');
  await expect(panel.getByTestId("embed-popup")).toContainText('data-mode="popup"');
  await expect(panel.getByTestId("embed-iframe")).toContainText(`/embed/${project.slug}/form/stories`);

  const [png] = await Promise.all([page.waitForEvent("download"), panel.getByTestId("qr-png").click()]);
  expect(png.suggestedFilename()).toBe("stories-qr.png");
  const pngBytes = fs.readFileSync((await png.path())!);
  expect([...pngBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const [svg] = await Promise.all([page.waitForEvent("download"), panel.getByTestId("qr-svg").click()]);
  expect(svg.suggestedFilename()).toBe("stories-qr.svg");
  const svgText = fs.readFileSync((await svg.path())!, "utf8");
  expect(svgText).toMatch(/^<svg[^>]+viewBox/);
  expect(svgText).toContain('fill="#161b2e"');
});

test("FORM-01 switching the classic default form to step by step moves /c on to /f", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, "Classic Co", `classic-${RUN}`);
  const def = (await (await api.get(`/api/admin/projects/${project.id}/forms`)).json()).forms[0];
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms/${def.id}`);
  await expect(page.getByTestId("classic-notice")).toBeVisible();
  await page.getByRole("button", { name: "Switch to step-by-step" }).click();
  await expect(page.getByTestId("classic-notice")).toHaveCount(0);
  await page.goto(`/c/${project.slug}?name=Rae`);
  await expect(page).toHaveURL(new RegExp(`/f/${project.slug}/${def.slug}\\?name=Rae$`));
  await expect(page.getByTestId("form-runner")).toBeVisible();
});

test("FORM-01 the forms list pauses, duplicates and deletes", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, "List Co", `list-${RUN}`);
  await api.post(`/api/admin/projects/${project.id}/forms`, { data: { name: "Event", template: "event" } });
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms`);
  const card = page.getByTestId("form-card").filter({ hasText: "Event" });
  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card.getByText("Paused")).toBeVisible();
  await card.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByTestId("form-card").filter({ hasText: "Event (copy)" })).toBeVisible();
  await page.getByLabel("Search forms").fill("copy");
  await expect(page.getByTestId("form-card")).toHaveCount(1);
  await page.getByTestId("form-card").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete form" }).click();
  await expect(page.getByTestId("form-card")).toHaveCount(0);
  // The default form has no Delete.
  await page.getByLabel("Search forms").fill("");
  await expect(page.getByTestId("form-card").filter({ hasText: "Default form" }).getByRole("button", { name: "Delete" })).toHaveCount(0);
});
