import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminApi, createProject, FIXTURES, fixtureRequests, fixtureRespond, resetFixtures, seed, signIn, useFreshIp } from "./helpers";

/**
 * M17 Insights and AI: case studies from a testimonial, with AI off (the
 * template) and with the stand-in AI provider (SHARE-04); Voice of Customer
 * and ask a question without AI, and a saved report (VOC-01); a survey whose
 * detractor stays private while a promoter opts in, both on the NPS
 * dashboard (NPS-01); and a screenshot read by the stand-in OCR command
 * (IMP-07). The suite's server points AI_API_URL at the fixture server,
 * which answers only what a test sets up; "AI off" is the per-project switch.
 */

const RUN = Date.now().toString(36);
const AI_PATH = "/ai/v1/chat/completions";

test.skip(process.env.E2E_SERVER_IN_CONTAINER === "true" || Boolean(process.env.E2E_BASE_URL), "Needs the suite's own server, which reaches the fixture server");

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
  await resetFixtures();
});
test.afterEach(async () => {
  await resetFixtures();
});

async function project(api: APIRequestContext, name: string, o: { ai: boolean }) {
  const p = await createProject(api, name, `${name.toLowerCase().replace(/\W+/g, "-")}-${RUN}`);
  if (!o.ai) expect((await api.put(`/api/admin/projects/${p.id}/ai`, { data: { enabled: false } })).ok()).toBe(true);
  return p;
}

/** What the stand-in provider answers next: one chat completion whose content is this JSON. */
const aiAnswers = (content: unknown) =>
  fixtureRespond({ path: AI_PATH, status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(content) } }] }), times: 1 });

const STORY = "Before Acme we chased customers for reviews by email every week. Within a month we had 40 video testimonials. Honestly the best tool we bought this year.";

test("SHARE-04 a case study from a testimonial with AI off: the template, the live preview, publishing, its public page and PDF", async ({ page, baseURL, browser }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Case Off", { ai: false });
  const [id] = await seed(api, p.slug, [{ name: "Dana Kim", email: "dana@private.example", text: STORY, rating: 5, status: "approved" }]);

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?open=${id}`);
  await page.getByTestId("detail-drawer").getByTestId("create-case-study").click();
  await expect(page).toHaveURL(new RegExp(`/case-studies\\?from=${id}$`));
  await expect(page.getByTestId("cs-testimonial")).toHaveValue(id);
  await page.getByTestId("cs-create").click();
  await expect(page).toHaveURL(/\/case-studies\/[0-9a-f-]{36}$/);

  // The template: the person, a title and the first sentence as the pull quote; no AI button, and a link saying how to get one.
  await expect(page.getByTestId("cs-title")).toHaveValue("Dana Kim and Case Off");
  await expect(page.getByTestId("cs-pullQuote")).toHaveValue("Before Acme we chased customers for reviews by email every week.");
  await expect(page.getByTestId("cs-ai-off")).toContainText("Fill in the template yourself");
  await expect(page.getByTestId("cs-draft-ai")).toHaveCount(0);

  // The preview follows the fields as they're typed.
  const preview = page.getByTestId("cs-preview");
  await page.getByTestId("cs-title").fill("How Dana's team got 40 videos");
  await page.getByTestId("cs-challenge").fill("Reviews took a week of emails.");
  await page.getByTestId("cs-result").fill("40 video testimonials in a month.");
  await page.getByTestId("cs-add-metric").click();
  await page.getByTestId("cs-metric-value-0").fill("40");
  await page.getByTestId("cs-metric-label-0").fill("videos in a month");
  await expect(preview.getByRole("heading", { name: "How Dana's team got 40 videos" })).toBeVisible();
  await expect(preview).toContainText("Reviews took a week of emails.");
  await expect(preview.getByRole("list", { name: "Results in numbers" })).toContainText("40videos in a month");

  await page.getByTestId("cs-publish").click();
  await expect(page.getByTestId("cs-note")).toHaveText("Published.");
  const link = page.getByTestId("cs-public-link");
  const url = await link.getAttribute("href");
  expect(url).toMatch(/\/cs\/[0-9a-f-]{36}$/);

  // The team's PDF download.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("cs-download-pdf").click()]);
  expect(download.suggestedFilename()).toBe("how-danas-team-got-40-videos.pdf");
  expect(fs.readFileSync((await download.path())!).subarray(0, 5).toString()).toBe("%PDF-");

  // The public page and its PDF, for anyone, without the private email.
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  const publicPath = new URL(url!).pathname;
  await visitor.goto(publicPath);
  const article = visitor.getByTestId("case-study-page");
  await expect(article.getByRole("heading", { level: 1 })).toHaveText("How Dana's team got 40 videos");
  await expect(article).toContainText("Reviews took a week of emails.");
  await expect(article).not.toContainText("dana@private.example");
  const pdf = await anon.request.get(`${publicPath}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Unpublished, or its testimonial no longer approved: both 404 at once.
  await page.getByTestId("cs-unpublish").click();
  await expect(page.getByTestId("cs-note")).toContainText("Unpublished");
  expect((await anon.request.get(publicPath)).status()).toBe(404);
  expect((await anon.request.get(`${publicPath}/pdf`)).status()).toBe(404);
  await anon.close();
});

test("SHARE-04 the Case study tab adds the testimonial, and Draft with AI fills it from the stand-in provider, keeping only what the customer said", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Case AI", { ai: true });
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByTestId("manual-add-open").click();
  const modal = page.getByTestId("manual-add");
  await modal.getByTestId("manual-kind").getByRole("button", { name: "Case study" }).click();
  await expect(modal.getByTestId("manual-case-study-note")).toBeVisible();
  await modal.getByLabel("Name", { exact: true }).fill("Lee Park");
  await modal.getByLabel("Company", { exact: true }).fill("Contoso");
  await modal.getByLabel("Email (private)").fill("lee@private.example");
  await modal.getByLabel("Testimonial text").fill(STORY);
  await modal.getByRole("button", { name: "Add testimonial" }).click();
  await expect(page).toHaveURL(/\/case-studies\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("cs-title")).toHaveValue("Contoso and Case AI");

  await aiAnswers({
    title: "How Contoso collects 40 video testimonials a month",
    summary: "Contoso stopped chasing reviews by email.",
    challenge: "They chased customers for reviews every week.",
    solution: "They sent one link instead.",
    result: "40 video testimonials within a month.",
    pullQuote: "Honestly the best tool we bought this year.",
    metrics: [
      { value: "40", label: "video testimonials in a month" },
      { value: "3x", label: "faster everything" },
    ],
  });
  await page.getByTestId("cs-draft-ai").click();
  await expect(page.getByTestId("cs-title")).toHaveValue("How Contoso collects 40 video testimonials a month");
  await expect(page.getByTestId("cs-pullQuote")).toHaveValue("Honestly the best tool we bought this year.");
  await expect(page.getByTestId("cs-metric-value-0")).toHaveValue("40");
  await expect(page.getByTestId("cs-metric-value-1")).toHaveCount(0);
  await expect(page.getByTestId("cs-note")).toContainText("3x faster everything");
  await expect(page.getByTestId("cs-preview")).toContainText("They sent one link instead.");

  // What reached the provider: the customer's words and the model, never their email.
  const sent = await fixtureRequests(AI_PATH, "POST");
  expect(sent).toHaveLength(1);
  const body = sent[0].json as { model: string; messages: { role: string; content: string }[] };
  expect(body.model).toBe("e2e-stand-in");
  expect(body.messages[1].content).toContain(STORY);
  expect(sent[0].body).not.toContain("lee@private.example");

  await page.getByTestId("cs-save").click();
  await expect(page.getByTestId("cs-note")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How Contoso collects 40 video testimonials a month");
  await expect(page.getByText(/Drafted with AI on/)).toBeVisible();
});

test("VOC-01 Insights without AI: shared phrases, what they love and what to improve, ask a question, and a saved report as CSV", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Voices", { ai: false });
  await seed(api, p.slug, [
    { name: "Maria Gonzalez", rating: 5, text: "So easy to use. Customer support answered within an hour.", status: "approved" },
    { name: "Tom Becker", rating: 5, text: "Easy to use and the customer support team is lovely.", status: "approved" },
    { name: "Ana Silva", rating: 4, text: "Easy to use, and the video widget looks great.", status: "approved" },
    { name: "Sam Okafor", rating: 2, text: "Too expensive, and the mobile app keeps crashing.", status: "approved" },
    { name: "Kofi Mensah", rating: 1, text: "The mobile app crashed twice while recording.", status: "approved" },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/insights`);
  await expect(page.getByTestId("insights-ai")).toContainText("AI is off for this project");
  await expect(page.getByTestId("voc-count-value")).toHaveText("5");
  await expect(page.getByTestId("voc-phrases")).toContainText("easy to use");
  await expect(page.getByTestId("voc-love")).toContainText("customer support");
  await expect(page.getByTestId("voc-improve")).toContainText("mobile app");
  await expect(page.getByTestId("voc-improve")).not.toContainText("easy to use");
  await expect(page.getByTestId("voc-ai")).toHaveCount(0);
  // People's names never count as words.
  await expect(page.getByTestId("voc-words")).not.toContainText("maria");

  await page.getByTestId("voc-save").click();
  await page.getByTestId("report-name").fill(`Voices ${RUN}`);
  await page.getByTestId("report-save-confirm").click();
  await expect(page.getByTestId("report-save-dialog")).toBeHidden();

  // Ask a question: without AI, the testimonials that answer it.
  await page.getByRole("tab", { name: "Ask a question" }).click();
  await page.getByTestId("ask-question").fill("What do they say about the mobile app?");
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("ask-matches").getByRole("listitem")).toHaveCount(2);
  await expect(page.getByTestId("ask-matches")).toContainText("Kofi Mensah");
  await expect(page.getByTestId("ask-note")).toContainText("With AI on, a short answer that cites them appears here.");
  await expect(page.getByTestId("ask-answer")).toHaveCount(0);
  expect(await fixtureRequests(AI_PATH, "POST")).toHaveLength(0);

  await page.getByRole("tab", { name: "Saved reports" }).click();
  const row = page.getByTestId("reports-list").getByRole("listitem").filter({ hasText: `Voices ${RUN}` });
  await expect(row).toBeVisible();
  await row.getByTestId("report-view").click();
  await expect(page.getByTestId("report-open").getByTestId("voc-phrases")).toContainText("easy to use");
  const href = await row.getByTestId("report-csv").getAttribute("href");
  const csv = await page.request.get(href!);
  expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  const text = await csv.text();
  expect(text).toMatch(/^Section,Item,Count,Summary,Testimonials\r\n/);
  expect(text).toContain("Phrase,easy to use,3,");
});

async function answerSurvey(page: Page, url: string, o: { score: number; why: string; feedback: string; testimonial?: { text: string; name: string } }) {
  await page.goto(url);
  await expect(page.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("fr-step")).toHaveAttribute("data-step-type", "nps");
  await page.getByTestId(`nps-score-${o.score}`).click();
  await page.getByTestId("nps-why-nps").fill(o.why);
  if (o.score >= 9) {
    await expect(page.getByTestId("nps-offer")).toBeVisible();
    if (o.testimonial) await page.getByTestId("nps-offer-yes").check();
  } else {
    await expect(page.getByTestId("nps-offer")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("fr-step")).toHaveAttribute("data-step-type", "feedback");
  await page.getByRole("textbox").fill(o.feedback);
  if (!o.testimonial) {
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("thank-you")).toContainText("Your answers help");
    return;
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("fr-step")).toHaveAttribute("data-step-type", "question");
  await page.getByRole("textbox").fill(o.testimonial.text);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("consent-text").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill(o.testimonial.name);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("thank-you")).toBeVisible();
}

test("NPS-01 a survey keeps a detractor's answer private, lets a promoter opt in to a testimonial, and shows both on the NPS dashboard", async ({ page, baseURL, browser }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Survey Co", { ai: false });
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/forms`);
  await page.getByTestId("new-survey").locator("summary").click();
  await expect(page.getByTestId("survey-ai-off")).toBeVisible();
  await page.getByTestId("survey-name").fill("Quarterly survey");
  await page.getByTestId("survey-questions").fill("What should we fix first?");
  await page.getByTestId("survey-create").click();
  await expect(page.getByTestId("survey-notice")).toContainText("It's paused");
  const formId = page.url().split("/").pop()!;
  // Published once checked.
  expect((await api.patch(`/api/admin/forms/${formId}`, { data: { status: "live" } })).ok()).toBe(true);
  const form = (await (await api.get(`/api/admin/forms/${formId}`)).json()).form as { slug: string };
  const url = `/f/${p.slug}/${form.slug}`;

  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await useFreshIp(visitor);
  await answerSurvey(visitor, url, { score: 3, why: "Setup was slow", feedback: "Faster imports, please" });
  await answerSurvey(visitor, url, { score: 10, why: "It just works", feedback: "Nothing", testimonial: { text: "Survey Co made collecting reviews painless.", name: "Pat Promoter" } });
  await anon.close();

  // The dashboard: one promoter, one detractor, NPS 0, and both comments.
  await page.goto(`/admin/projects/${p.id}/insights`);
  await page.getByRole("tab", { name: "NPS" }).click();
  await expect(page.getByTestId("nps-score-value")).toHaveText("0");
  await expect(page.getByTestId("nps-promoters-value")).toHaveText("1");
  await expect(page.getByTestId("nps-detractors-value")).toHaveText("1");
  await expect(page.getByTestId("nps-comments")).toContainText("Setup was slow");
  await expect(page.getByTestId("nps-comments")).toContainText("It just works");
  await expect(page.getByTestId("nps-comments")).toContainText("also sent a testimonial");

  // Only the promoter who said yes became a testimonial; the private answers are in Feedback.
  const { testimonials } = (await (await api.get(`/api/admin/projects/${p.id}`)).json()) as { testimonials: { authorName: string; status: string }[] };
  expect(testimonials.map((t) => [t.authorName, t.status])).toEqual([["Pat Promoter", "pending"]]);
});

test("IMP-07 a screenshot is read by the OCR command, checked by the owner, and kept as the testimonial's screenshot", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await project(api, "Shots", { ai: false });
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/data`);
  const panel = page.getByTestId("screenshot-import");
  await expect(panel).toContainText("Plaudit reads the quote, the name and the date");
  await panel.getByTestId("screenshot-import-open").click();
  const modal = page.getByTestId("manual-add");
  await expect(modal.getByTestId("manual-kind").getByRole("button", { name: "Image" })).toHaveAttribute("aria-pressed", "true");
  await modal.getByTestId("manual-images").setInputFiles(path.join(FIXTURES, "avatar.png"));
  await modal.getByTestId("manual-ocr").click();
  await expect(modal.getByTestId("manual-ocr-done")).toContainText("found Jamie Rivera, 2026-05-03");
  await expect(modal.getByLabel("Name", { exact: true })).toHaveValue("Jamie Rivera");
  await expect(modal.getByLabel("Date")).toHaveValue("2026-05-03");
  const text = modal.getByLabel("Testimonial text (optional)");
  await expect(text).toHaveValue("Collecting reviews used to take us a week of emails. Now our customers reply in minutes and we share the best ones the same day.");
  // The owner corrects what was read before saving.
  await text.fill("Collecting reviews used to take a week. Now customers reply in minutes.");
  await modal.getByRole("button", { name: "Add testimonial" }).click();
  await expect(panel.getByTestId("screenshot-import-done")).toContainText("Added a testimonial");

  await page.goto(`/admin/projects/${p.id}`);
  // Added by hand, so approved.
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Approved/ }).click();
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Jamie Rivera" });
  await expect(card).toContainText("Now customers reply in minutes.");
  await card.getByRole("button", { name: "Details" }).click();
  await expect(page.getByTestId("detail-drawer").getByRole("img", { name: "Attached image" })).toHaveCount(1);
});
