import { expect, test } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, seed, signIn, useFreshIp } from "./helpers";

/**
 * WP2.6: a multi-question submission in the dashboard. The card shows the
 * form, every answer, the custom fields (NPS included), the hidden field from
 * the link and the dropdown's auto tag; a "rating ≥ 5" rule approved it.
 */

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("FORM-04 FORM-06 FORM-07 the inbox card shows 3 answers, NPS, the hidden field and the auto tag", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project } = await formProject(api, "Inbox Answers Co", {
    pages: [
      { type: "rating" },
      { type: "question", key: "q1", primary: true, title: "What changed?", mode: "text" },
      { type: "question", key: "q2", title: "What almost stopped you?", mode: "text", required: false },
      { type: "question", key: "q3", title: "Who should try it?", mode: "text" },
      { type: "feedback", key: "note", title: "Anything private?" },
      { type: "consent" },
      {
        type: "about_you",
        custom: [
          { key: "plan", type: "dropdown", label: "Plan", options: [{ label: "Starter" }, { label: "Enterprise", tag: "enterprise" }] },
          { key: "nps", type: "nps", label: "NPS" },
        ],
      },
      { type: "thank_you" },
    ],
    settings: { hiddenFields: ["utm_source"], autoApprove: { mode: "rating", minRating: 5 } },
  });
  const [id] = await seed(api, project.slug, [
    {
      name: "Multi Mo",
      rating: 5,
      formSlug: "stories",
      answers: { q1: "We ship weekly now.", q2: "The price, at first.", q3: "Small product teams." },
      customFields: { plan: "Enterprise", nps: 9 },
      hiddenFields: { utm_source: "newsletter" },
    },
  ]);
  const t = (await (await api.get(`/api/admin/testimonials/${id}/detail`)).json()).testimonial;
  expect(t).toMatchObject({ status: "approved", approvedBy: "auto" });

  await signIn(page);
  await page.goto(`/admin/projects/${project.id}`);
  await page.getByRole("button", { name: "Approved" }).click();
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Multi Mo" });
  await expect(card).toContainText("We ship weekly now.");
  const extras = card.getByTestId("testimonial-extras");
  await expect(extras.getByTestId("form-badge")).toHaveText("Stories");
  await expect(extras).toContainText("Answering “What changed?”");
  await expect(extras.getByTestId("answers").locator("li")).toHaveCount(2);
  await expect(extras.getByTestId("answers")).toContainText("The price, at first.");
  await expect(extras.getByTestId("answers")).toContainText("Small product teams.");
  await expect(extras.locator("[data-field=nps]")).toContainText("9");
  await expect(extras.locator("[data-field=plan]")).toContainText("Enterprise");
  await expect(extras.locator("[data-hidden=utm_source]")).toContainText("newsletter");
  await expect(card.getByLabel(/Tags/)).toHaveValue(/enterprise/);
});

test("FORM-04 a classic testimonial's card looks as it always did", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project } = await formProject(api, "Inbox Classic Co");
  await seed(api, project.slug, [{ name: "Classic Cleo", text: "Plain and simple." }]);
  await signIn(page);
  // Its answers are looked up (it came through the default form), and there's nothing extra to show.
  const looked = page.waitForResponse((r) => r.url().includes("/detail") && r.ok());
  await page.goto(`/admin/projects/${project.id}`);
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Classic Cleo" });
  await expect(card).toContainText("Plain and simple.");
  await looked;
  await expect(card.getByTestId("form-badge")).toHaveCount(0);
  await expect(card.getByTestId("answers")).toHaveCount(0);
});
