import { expect, test, type Page } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, useFreshIp } from "./helpers";

/**
 * Draft autosave on the step-by-step form (FORM-14): answers stay in this
 * browser across a reload, the form offers them back, and nothing reaches
 * the server before Send. No camera, so this also runs in WebKit.
 */

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

const PAGES = [
  { type: "rating" },
  { type: "question", key: "q1", primary: true, title: "What changed for you?", mode: "text" },
  { type: "question", key: "q2", title: "Anything else?", mode: "text", required: false },
  { type: "consent" },
  { type: "about_you", fields: { email: { enabled: false }, photo: { enabled: false }, title: { enabled: false }, company: { enabled: false } } },
  { type: "thank_you" },
];

const step = (page: Page) => page.getByTestId("fr-step");
const next = (page: Page) => page.getByRole("button", { name: "Continue", exact: true }).click();
const ready = (page: Page) => expect(page.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");
const draftOf = (page: Page, formId: string) => page.evaluate((k) => localStorage.getItem(k), `plaudit:draft:${formId}`);

test("FORM-14 two steps survive a reload: continue where you left off, then send; the draft is gone after", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form, url } = await formProject(api, "Draft Co", { pages: PAGES });
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") posts.push(r.url());
  });

  await page.goto(url);
  await ready(page);
  await expect(page.getByTestId("fr-resume")).toHaveCount(0);
  await page.getByRole("radio", { name: "4 stars" }).click();
  await next(page);
  await page.getByRole("textbox").fill("Our onboarding went from days to an hour.");
  await next(page);
  await expect(step(page)).toHaveAttribute("data-step-key", "q2");
  await page.getByRole("textbox").fill("Support answers fast");
  await expect.poll(() => draftOf(page, form.id)).toContain("Support answers fast");
  expect(posts).toEqual([]);

  await page.reload();
  await ready(page);
  const prompt = page.getByTestId("fr-resume");
  await expect(prompt).toContainText("You started this testimonial earlier on this device.");
  await expect(prompt).not.toContainText("record yours again");
  await prompt.getByRole("button", { name: "Continue where you left off" }).click();
  await expect(step(page)).toHaveAttribute("data-step-key", "q2");
  await expect(page.getByRole("textbox")).toHaveValue("Support answers fast");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("Our onboarding went from days to an hour.");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await next(page);
  await next(page);
  await next(page);
  // Consent is never kept in a draft: it is given again.
  await page.getByTestId("consent-text").click();
  await next(page);
  await page.getByLabel("Your name").fill("Dana Draft");
  expect(posts).toEqual([]);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("thank-you")).toBeVisible({ timeout: 20_000 });
  expect(await draftOf(page, form.id)).toBeNull();

  const body = await (await api.get(`/api/admin/projects/${project.id}`)).json();
  const t = body.testimonials.find((x: { authorName: string }) => x.authorName === "Dana Draft");
  expect(t).toMatchObject({ rating: 4, text: "Our onboarding went from days to an hour." });

  await page.reload();
  await ready(page);
  await expect(page.getByTestId("fr-resume")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "4 stars" })).not.toBeChecked();
});

test("FORM-14 start over clears the draft and the answers", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { form, url } = await formProject(api, "Fresh Start Co", { pages: PAGES });
  await page.goto(url);
  await ready(page);
  await page.getByRole("radio", { name: "5 stars" }).click();
  await next(page);
  await page.getByRole("textbox").fill("A first try");
  await expect.poll(() => draftOf(page, form.id)).toContain("A first try");

  await page.reload();
  await ready(page);
  await page.getByTestId("fr-resume").getByRole("button", { name: "Start over" }).click();
  await expect(step(page)).toHaveAttribute("data-step-type", "rating");
  await expect(page.getByRole("radio", { name: "5 stars" })).not.toBeChecked();
  expect(await draftOf(page, form.id)).toBeNull();
  await next(page);
  await expect(page.getByRole("textbox")).toHaveValue("");

  await page.reload();
  await ready(page);
  await expect(page.getByTestId("fr-resume")).toHaveCount(0);
});
