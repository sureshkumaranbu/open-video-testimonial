import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, signIn, useFreshIp } from "./helpers";

/**
 * M10 on forms: rewards on the thank-you page (FORM-13), the opt-in
 * low-rating branch (FORM-12), and per-recipient codes in campaigns
 * (REQ-08). Text answers only, so these run in WebKit too.
 */

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

const PAGES = [
  { type: "rating" },
  { type: "question", key: "q1", primary: true, title: "What did you like?", mode: "text" },
  { type: "consent" },
  { type: "about_you", fields: { email: { enabled: false }, photo: { enabled: false }, title: { enabled: false }, company: { enabled: false } } },
  { type: "thank_you", message: "Thanks a lot!" },
];

const ready = (page: Page) => expect(page.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");
const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function setReward(api: APIRequestContext, formId: string, reward: object) {
  const res = await api.patch(`/api/admin/forms/${formId}`, { data: { reward } });
  expect(res.status(), await res.text()).toBe(200);
}

async function sendTestimonial(page: Page, url: string, stars: number) {
  await page.goto(url);
  await ready(page);
  await page.getByRole("radio", { name: `${stars} stars` }).click();
  await next(page);
  await page.getByRole("textbox").fill("Friendly and quick.");
  await next(page);
  await page.getByTestId("consent-text").click();
  await next(page);
  await page.getByLabel("Your name").fill("Rita Reward");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("thank-you")).toContainText("Thanks a lot!");
}

test("FORM-13 a wheel reward spins on the thank-you page to the prize the server picked", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { form, url } = await formProject(api, "Wheel Co", { pages: PAGES });
  await setReward(api, form.id, {
    mode: "wheel",
    title: "Spin for a thank-you",
    prizes: [
      { id: "none", label: "Free year", code: "NEVER", weight: 0 },
      { id: "mug", label: "A mug", code: "MUG-42", weight: 100 },
    ],
  });
  await sendTestimonial(page, url, 5);
  const reward = page.getByTestId("reward");
  await expect(reward).toContainText("Spin for a thank-you");
  await expect(reward).toContainText("0% chance");
  await expect(page.getByTestId("reward-prize")).toHaveText("You won: A mug", { timeout: 10_000 });
  await expect(page.getByTestId("reward-code")).toHaveText("MUG-42");
  await expect(page.locator("body")).not.toContainText("NEVER");
});

test("FORM-13 unique codes from a pasted list, claim tracking in the builder, and a graceful note once they run out", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form, url } = await formProject(api, "Pool Co", { pages: PAGES });
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms/${form.id}?tab=settings`);
  await page.getByTestId("reward-mode").selectOption("same");
  await expect(page.getByTestId("reward-rules")).toContainText("whatever they rate or say");
  await page.getByTestId("reward-kind").selectOption("pool");
  await expect(page.getByTestId("reward-pool-stats")).toContainText("No codes yet");
  await page.getByTestId("reward-codes-text").fill("SPRING-1");
  await page.getByTestId("reward-codes-add").click();
  await expect(page.getByTestId("reward-pool-stats")).toContainText("1 of 1 codes left");
  await page.getByTestId("save-form").click();
  await expect(page.getByTestId("save-form")).toHaveText("Saved");

  await sendTestimonial(page, url, 4);
  await expect(page.getByTestId("reward-code")).toHaveText("SPRING-1");
  await useFreshIp(page);
  await sendTestimonial(page, url, 5);
  await expect(page.getByTestId("reward-sold-out")).toContainText("All the rewards have been claimed");

  await page.goto(`/admin/projects/${project.id}/forms/${form.id}?tab=settings`);
  await expect(page.getByTestId("reward-pool-stats")).toContainText("All 1 codes have been claimed");
  await page.getByText(/Claimed codes/).click();
  await expect(page.getByTestId("reward-claims")).toContainText("SPRING-1");
  await expect(page.getByTestId("reward-claims")).toContainText("Rita Reward");
});

test("FORM-12 off by default; turned on, a low rating swaps the questions for private feedback, gets the same reward, and lands in Feedback", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form, url } = await formProject(api, "Lowrate Co", { pages: PAGES });
  await setReward(api, form.id, { mode: "same", kind: "code", code: "THANKS-ALL" });
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms/${form.id}?tab=settings`);
  const toggle = page.getByTestId("low-rating-toggle").getByRole("switch");
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId("low-rating-notice")).toContainText("Don't use this to gate reviews for Google, Trustpilot");
  await toggle.check();
  await page.getByTestId("low-rating-threshold").selectOption("2");
  await page.getByTestId("save-form").click();
  await expect(page.getByTestId("save-form")).toHaveText("Saved");

  await page.goto(url);
  await ready(page);
  await page.getByRole("radio", { name: "1 star", exact: true }).click();
  await next(page);
  await expect(page.getByTestId("fr-step")).toHaveAttribute("data-step-type", "feedback");
  await expect(page.getByRole("heading", { name: "We're sorry it wasn't better" })).toBeVisible();
  // Continue without writing anything is refused.
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.getByTestId("low-rating-text").fill("The parcel arrived late.");
  await page.getByTestId("low-rating-contact").getByLabel("Name").fill("Lou");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("thank-you")).toBeVisible();
  // The same reward as everyone, and no withdraw link: nothing was published.
  await expect(page.getByTestId("reward-code")).toHaveText("THANKS-ALL");
  await expect(page.getByTestId("withdraw-note")).toHaveCount(0);

  // Back on a higher rating, the questions are there as usual.
  await page.goto(url);
  await ready(page);
  await page.getByRole("radio", { name: "1 star", exact: true }).click();
  await page.getByRole("radio", { name: "3 stars" }).click();
  await next(page);
  await expect(page.getByTestId("fr-step")).toHaveAttribute("data-step-key", "q1");

  await page.goto(`/admin/projects/${project.id}?tab=feedback`);
  const item = page.getByTestId("feedback-item").filter({ hasText: "The parcel arrived late." });
  await expect(item).toContainText("Low rating");
  await expect(item).toContainText("Lou");
  const list = await (await api.get(`/api/admin/projects/${project.id}/testimonials`)).json();
  expect(JSON.stringify(list)).not.toContain("The parcel arrived late.");
});

test("REQ-08 a campaign gives each recipient their own code: the toggle, the pool count and {{reward_code}} in the preview", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form } = await formProject(api, "Recipient Co", { pages: PAGES });
  await api.post(`/api/admin/forms/${form.id}/reward-codes`, { data: { text: "R-1\nR-2" } });
  const made = await api.post(`/api/admin/projects/${project.id}/campaigns`, { data: { name: "Thanks", formId: form.id } });
  const { campaign } = await made.json();
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/campaigns/${campaign.id}`);
  await page.getByRole("tab", { name: "Email" }).click();
  await page.getByTestId("campaign-reward-codes").getByRole("switch").check();
  await expect(page.getByTestId("campaign-reward-pool")).toContainText("2 of 2 codes left");
  await page.getByLabel("Message").fill("Hi {{first_name}}, your code: {{reward_code}}\n\n{{link}}");
  await page.getByRole("button", { name: "Plain text" }).click();
  await expect(page.getByTestId("preview-text")).toContainText("your code: SAMPLE-CODE", { timeout: 10_000 });
  await expect(page.getByTestId("campaign-variables")).toContainText("{{reward_code}}");
});
