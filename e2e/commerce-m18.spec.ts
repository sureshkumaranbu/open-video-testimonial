import crypto from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, allowClipboard, createProject, fixtureRequests, fixtureRespond, hostPage, resetFixtures, seed, signIn, startHostServer, useFreshIp } from "./helpers";

/**
 * M18 commerce: a purchase from a signed Stripe webhook in the sales popup
 * on another site, a Stripe coupon reward made at the fixture server's
 * stand-in Stripe API, and the social post panel after approving. Nothing
 * reaches the real Stripe, X or LinkedIn. Text only, so these run in WebKit too.
 */

const RUN = Date.now().toString(36);
const SECRET = "whsec_e2e_purchases_0123456789";
const KEY = "rk_test_e2eRestrictedKey1234";

test.skip(() => Boolean(process.env.E2E_BASE_URL), "needs the suite's own server (the fixture server stands in for Stripe)");

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
  await resetFixtures();
});

/** The header Stripe sends: t=<seconds>,v1=HMAC-SHA256(secret, "t.body"). */
const stripeSignature = (secret: string, raw: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
};

async function connectStripe(api: APIRequestContext, projectId: string, extra: Record<string, unknown> = {}) {
  const res = await api.put(`/api/admin/projects/${projectId}/stripe`, { data: { signingSecret: SECRET, ...extra } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()).connection as { id: string; url: string };
}

test("INT-07 a purchase from a signed Stripe webhook shows in the sales popup on another site, and its close button is remembered", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, "Popup Co", `popup-co-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/commerce`);
  await page.getByTestId("stripe-signing-secret").fill(SECRET);
  await page.getByTestId("stripe-save").click();
  await expect(page.getByTestId("stripe-state")).toHaveText("On");
  const hook = await page.getByTestId("stripe-url").locator("input").inputValue();
  expect(hook).toMatch(/\/api\/hooks\/stripe-purchases\//);

  // Stripe, played by the test: a signed checkout.session.completed with more than the popup may keep.
  const raw = JSON.stringify({
    id: `evt_${RUN}`,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000) - 2 * 3600,
    data: { object: { payment_status: "paid", amount_total: 2900, currency: "gbp", metadata: { product_name: "Pro plan" }, customer_details: { name: "Priya Sharma", email: "priya@example.com", address: { line1: "1 High Street", city: "Leeds", country: "GB" } } } },
  });
  const sent = await api.post(new URL(hook).pathname, { data: raw, headers: { "stripe-signature": stripeSignature(SECRET, raw), "content-type": "application/json" } });
  expect(sent.status(), await sent.text()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("purchase-row")).toContainText("Priya");
  await expect(page.getByTestId("purchase-row")).not.toContainText("Sharma");

  const made = await api.post(`/api/admin/projects/${project.id}/widgets`, { data: { name: "Sales popup", layout: "sales", config: { options: { toastDelay: 0, toastDuration: 30, toastPosition: "bottom-right" } } } });
  expect(made.status(), await made.text()).toBe(201);
  const widgetId = (await made.json()).widget.id as string;

  const host = await startHostServer();
  try {
    host.pages["/shop"] = hostPage("Shop", `<p>Our shop</p><script src="${baseURL}/widget.js" data-widget="${widgetId}" async></script>`);
    const visitor = await page.context().browser()!.newPage();
    await visitor.goto(`${host.url}/shop`);
    const popup = visitor.locator(`[data-plaudit-widget="${widgetId}"]`);
    await expect(popup.locator(".sp .ln")).toHaveText("Priya from Leeds bought Pro plan");
    await expect(popup.locator(".sp .sub")).toContainText(/2 hours ago/);
    await expect(popup.locator('[aria-live="polite"]')).toHaveCount(1);
    await expect(popup.locator("body, .sp")).not.toContainText("Sharma");
    await popup.getByRole("button", { name: "Dismiss" }).click();
    await expect(popup).toHaveAttribute("data-dismissed", "");
    await visitor.reload();
    await expect(visitor.locator(`[data-plaudit-widget="${widgetId}"]`)).toHaveAttribute("data-plaudit-ready", /\d/);
    await expect(visitor.locator(`[data-plaudit-widget="${widgetId}"] .sp`)).toHaveCount(0);
    await visitor.close();
  } finally {
    await host.close();
  }
});

const PAGES = [
  { type: "rating" },
  { type: "question", key: "q1", primary: true, title: "What did you like?", mode: "text" },
  { type: "consent" },
  { type: "about_you", fields: { email: { enabled: false }, photo: { enabled: false }, title: { enabled: false }, company: { enabled: false } } },
  { type: "thank_you", message: "Thanks a lot!" },
];

async function sendTestimonial(page: Page, url: string, stars: number) {
  await page.goto(url);
  await expect(page.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");
  await page.getByRole("radio", { name: `${stars} stars` }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox").fill("Friendly and quick.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("consent-text").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill("Cora Coupon");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("thank-you")).toContainText("Thanks a lot!");
}

test("INT-07 a Stripe coupon reward is made at the stand-in Stripe API when someone sends the form; a Stripe error still thanks them", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form, url } = await formProject(api, "Coupon Co", { pages: PAGES });
  await connectStripe(api, project.id, { restrictedKey: KEY });
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms/${form.id}?tab=settings`);
  await page.getByTestId("reward-mode").selectOption("same");
  await page.getByTestId("reward-kind").selectOption("stripe");
  await expect(page.getByTestId("reward-stripe")).toContainText("Promotion codes, Write");
  await page.getByTestId("reward-stripe-coupon").fill("THANKS10");
  await page.getByTestId("save-form").click();
  await expect(page.getByTestId("save-form")).toHaveText("Saved");

  await fixtureRespond({ path: "/stripe/v1/promotion_codes", body: { id: "promo_e2e", object: "promotion_code", code: "THANKS-E2E-7Q" }, times: 1 });
  await sendTestimonial(page, url, 2);
  await expect(page.getByTestId("reward-code")).toHaveText("THANKS-E2E-7Q");
  const [call] = await fixtureRequests("/stripe/v1/promotion_codes", "POST");
  expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
  const body = new URLSearchParams(call.body);
  expect(body.get("coupon")).toBe("THANKS10");
  expect(body.get("max_redemptions")).toBe("1");

  await fixtureRespond({ path: "/stripe/v1/promotion_codes", status: 400, body: { error: { message: "No such coupon: 'THANKS10'" } }, times: 1 });
  await useFreshIp(page);
  await sendTestimonial(page, url, 5);
  await expect(page.getByTestId("reward-unavailable")).toContainText("couldn't be made just now");
  await page.goto(`/admin/projects/${project.id}/commerce`);
  await expect(page.getByTestId("stripe-last")).toContainText("No such coupon");
});

test("INT-08 after approving, the drawer's Social post panel drafts a post in the customer's words, saves edits and opens X's and LinkedIn's share pages", async ({ page, baseURL, context, browserName }) => {
  await allowClipboard(context, browserName, new URL(baseURL!).origin);
  const api = await adminApi(baseURL!);
  const project = await createProject(api, "Social Co", `social-co-${RUN}`);
  await seed(api, project.slug, [{ name: "Sasha Social", text: "We get ten testimonials a week now. The team loves it." }]);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}?tab=all`);
  await page.getByTestId("admin-testimonial").filter({ hasText: "Sasha Social" }).getByRole("button", { name: "Details" }).click();
  const drawer = page.getByTestId("detail-drawer");
  await expect(drawer.getByTestId("social-post")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Approve" }).click();
  await expect(drawer.getByTestId("detail-status")).toHaveText("Approved");

  const panel = drawer.getByTestId("social-post");
  await expect(panel.getByTestId("social-text")).toHaveValue("“We get ten testimonials a week now. The team loves it.”\n— Sasha Social");

  const id = await drawer.getByTestId("detail").getAttribute("data-id");
  const link = `${baseURL}/t/${id}`;
  await expect(panel.getByTestId("share-linkedin")).toHaveAttribute("href", `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`);

  await panel.getByTestId("social-text").fill("Ten a week now, says Sasha.");
  await expect(panel.getByTestId("social-count")).toContainText("characters left on X");
  await expect(panel.getByTestId("share-x")).toHaveAttribute("href", `https://x.com/intent/tweet?text=${encodeURIComponent("Ten a week now, says Sasha.")}&url=${encodeURIComponent(link)}`);
  await expect(panel.getByTestId("share-x")).toHaveAttribute("target", "_blank");
  await panel.getByTestId("social-save").click();
  await expect(panel).toContainText("Saved.");
  await panel.getByTestId("social-copy").click();
  await expect(panel).toContainText("Copied the post and its link.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`Ten a week now, says Sasha.\n\n${link}`);

  // Rewrite with AI (the suite's stand-in provider): kept only when it quotes the customer word for word.
  const ai = (text: string, quote: string) =>
    fixtureRespond({ path: "/ai/v1/chat/completions", body: { choices: [{ message: { content: JSON.stringify({ text, quote }) } }] }, times: 1 });
  await ai("Sasha doubled our revenue: “It doubled our revenue.”", "It doubled our revenue.");
  await panel.getByTestId("social-ai").click();
  await expect(panel.getByRole("alert")).toContainText("wasn't the customer's own words");
  await expect(panel.getByTestId("social-text")).toHaveValue("Ten a week now, says Sasha.");
  await ai("Ten a week, and “The team loves it.” — Sasha Social", "The team loves it.");
  await panel.getByTestId("social-ai").click();
  await expect(panel.getByTestId("social-text")).toHaveValue("Ten a week, and “The team loves it.” — Sasha Social");
  await expect(panel).toContainText("Save to keep it.");

  // Saved: a fresh look shows the saved edit (not the unsaved suggestion), and "Use the template" brings the draft back.
  await page.reload();
  await page.getByTestId("admin-testimonial").filter({ hasText: "Sasha Social" }).getByRole("button", { name: "Details" }).click();
  await expect(drawer.getByTestId("social-text")).toHaveValue("Ten a week now, says Sasha.");
  await drawer.getByRole("button", { name: "Use the template" }).click();
  await expect(drawer.getByTestId("social-text")).toHaveValue(/^“We get ten testimonials/);
});
