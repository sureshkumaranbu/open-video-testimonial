import { expect, test, type Page } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, useFreshIp } from "./helpers";

/**
 * The public step-by-step form (FORM-03..07, 09, 10, 16): one step per
 * screen, Back keeps answers, optional questions, recordings that survive
 * moving between steps, labels in other languages, and the paused message.
 */

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

async function record(page: Page, seconds = 2) {
  await page.getByRole("button", { name: "Record with camera" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText(new RegExp(`^REC 00:0[${seconds}-9]$`))).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Stop/ }).click();
  await expect(page.getByTestId("video-recorder")).toHaveAttribute("data-state", "recorded");
}

const step = (page: Page) => page.getByTestId("fr-step");
const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
/** Waits until the runner's scripts are running, so typing reaches React. */
const ready = (page: Page) => expect(page.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");

test("FORM-03 steps at 375 px: Back keeps answers, Q2 skipped, Q3's recording survives moving away", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  const api = await adminApi(baseURL!);
  const { project, url } = await formProject(api, "Steps Co", { settings: { hiddenFields: ["utm_source"] } });
  const deletes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/api/uploads/")) deletes.push(r.url());
  });

  await page.goto(`${url}?utm_source=newsletter&name=Ada%20Lovelace`);
  await ready(page);
  await expect(page.getByTestId("fr-progress")).toBeVisible();
  // Nothing on the page is wider than the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("radio", { name: "5 stars" }).click();
  await next(page);

  // Q1: record a video.
  await expect(step(page)).toHaveAttribute("data-step-key", "q1");
  await page.getByRole("button", { name: "Video" }).click();
  await record(page);
  await next(page);
  // Q2 is optional: Back to Q1 keeps its recording, then skip Q2.
  await expect(step(page)).toHaveAttribute("data-step-key", "q2");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("video-recorder")).toHaveAttribute("data-state", "recorded");
  await next(page);
  await page.getByRole("button", { name: "Skip this question" }).click();

  // Q3 is video only: Continue without a video is refused.
  await expect(step(page)).toHaveAttribute("data-step-key", "q3");
  await next(page);
  await expect(page.getByRole("alert").filter({ hasText: "Record or upload a video" })).toBeVisible();
  await record(page);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("video-recorder")).toHaveAttribute("data-state", "recorded");
  await expect(page.getByTestId("upload-status")).toHaveAttribute("data-done", "true", { timeout: 15_000 });
  expect(deletes).toEqual([]);
  await next(page);

  // Consent, then about you (prefilled name), then review.
  await next(page);
  await expect(page.getByRole("alert").filter({ hasText: "consent" })).toBeVisible();
  await page.getByTestId("consent-text").click();
  await next(page);
  await expect(page.getByLabel("Your name")).toHaveValue("Ada Lovelace");
  await page.getByLabel("Your plan").selectOption("Enterprise");
  await page.getByRole("button", { name: "9", exact: true }).click();
  await next(page);
  const review = page.getByTestId("review");
  await expect(review).toContainText("Anything else?");
  await expect(review).toContainText("Skipped");
  await expect(review).toContainText("Video recorded");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("thank-you")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("withdraw-note")).toBeVisible();

  const body = await (await api.get(`/api/admin/projects/${project.id}`)).json();
  const t = body.testimonials.find((x: { authorName: string }) => x.authorName === "Ada Lovelace");
  const detail = await (await api.get(`/api/admin/testimonials/${t.id}/detail`)).json();
  expect(detail.testimonial.tags).toContain("enterprise");
  expect(JSON.parse(detail.testimonial.hiddenFields)).toEqual({ utm_source: "newsletter" });
  expect(JSON.parse(detail.testimonial.customFields)).toEqual({ plan: "Enterprise", nps: 9 });
  expect(detail.testimonial.videoOriginalKey ?? detail.testimonial.videoKey).toBeTruthy();
  expect(detail.answers.map((a: { questionKey: string }) => a.questionKey)).toEqual(["q3"]);
});

test("FORM-03 on desktop the same steps work, and FORM-16 offers to copy their words", async ({ page, baseURL, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const api = await adminApi(baseURL!);
  const { url } = await formProject(api, "Desktop Co", {
    pages: [
      { type: "question", key: "q1", primary: true, title: "What did you like?", mode: "text" },
      { type: "consent", scopes: ["social"] },
      { type: "about_you", fields: { email: { enabled: false }, photo: { enabled: false }, title: { enabled: false }, company: { enabled: false } } },
      { type: "thank_you", copyText: true, share: true, message: "Thanks a lot!" },
    ],
  });
  await page.goto(url);
  await ready(page);
  await page.getByRole("textbox").fill("Lovely service, quick replies.");
  await next(page);
  await page.getByTestId("consent-text").click();
  await page.getByLabel("Social media posts").check();
  await next(page);
  await page.getByLabel("Your name").fill("Desk Top");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("thank-you")).toContainText("Thanks a lot!");
  await expect(page.getByTestId("my-words")).toHaveText("Lovely service, quick replies.");
  await page.getByRole("button", { name: "Copy my words" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Lovely service, quick replies.");
  // Social consent: share links carry the quote.
  await expect(page.getByRole("link", { name: "Share on LinkedIn" })).toHaveAttribute("href", /Lovely%20service/);
});

test("FORM-09 Spanish and Arabic labels; Arabic reads right to left", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const es = await formProject(api, "Hola Co", { language: "es" });
  await page.goto(es.url);
  await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿Qué tal ha sido tu experiencia?" })).toBeVisible();

  const ar = await formProject(api, "Marhaba Co", { language: "ar" });
  await page.goto(ar.url);
  const root = page.getByTestId("form-runner");
  await expect(root).toHaveAttribute("dir", "rtl");
  await expect(root).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("button", { name: "متابعة" })).toBeVisible();
});

test("FORM-10 a paused form shows its closed message", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { form, url } = await formProject(api, "Paused Co", { settings: { closedMessage: "We're collecting again in spring." } });
  await api.patch(`/api/admin/forms/${form.id}`, { data: { status: "paused" } });
  await page.goto(url);
  await expect(page.getByTestId("form-closed")).toContainText("We're collecting again in spring.");
  await expect(page.getByTestId("fr-step")).toHaveCount(0);
});

test("FORM-07 an old form link and the default form's /c link move on, query and all", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form } = await formProject(api, "Moves Co");
  await api.post(`/api/admin/forms/${form.id}/slug`, { data: { slug: "love" } });
  const res = await page.request.get(`/f/${project.slug}/stories?utm_source=x`, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe(`/f/${project.slug}/love?utm_source=x`);
  // Classic default stays on /c until it's switched to step by step.
  expect((await page.request.get(`/c/${project.slug}`, { maxRedirects: 0 })).status()).toBe(200);
  const forms = (await (await api.get(`/api/admin/projects/${project.id}/forms`)).json()).forms;
  const def = forms.find((f: { isDefault: boolean }) => f.isDefault);
  await api.post(`/api/admin/forms/${def.id}/upgrade`);
  const moved = await page.request.get(`/c/${project.slug}?r=abc`, { maxRedirects: 0 });
  expect(moved.status()).toBe(308);
  expect(moved.headers().location).toBe(`/f/${project.slug}/${def.slug}?r=abc`);
});
