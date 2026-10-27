import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";
import { adminApi, createProject, fixtureRequests, fixtureUrl, resetFixtures, seed, signIn, useFreshIp, waitForMail } from "./helpers";

/**
 * Notifications (INT-01, INT-02): the owner's own emails, chat channels
 * posting to the fixture server (standing in for Slack), the per-form choice
 * and the webhook editor. Every test switches its emails off again, so later
 * specs that count mail see none of these.
 */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test.afterEach(async ({ baseURL }) => {
  const api = await adminApi(baseURL!);
  await api.put("/api/admin/me/notifications", { data: { notifications: { newTestimonial: "off", weeklyPending: false, importSummary: false, monthlyReport: false } } });
});

test.describe("chat channels", () => {
  test.skip(process.env.E2E_SERVER_IN_CONTAINER === "true" || Boolean(process.env.E2E_BASE_URL), "Needs the suite's own server, which reaches the fixture server");

  test("INT-02 a new submission posts to Slack with the quote, stars and an approve link, plus an outbox email", async ({ page, baseURL }) => {
    await resetFixtures();
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Notify Co", `notify-${RUN}`);
    const hook = `/hooks/slack-${RUN}`;
    await signIn(page);
    await page.goto("/admin/settings");

    // My emails: one per testimonial.
    const prefs = page.getByTestId("notify-prefs");
    await prefs.getByLabel("New testimonials").selectOption("instant");
    await prefs.getByRole("button", { name: "Save email settings" }).click();
    await expect(prefs.getByRole("status")).toHaveText("Saved");

    // A Slack channel for this project only.
    const channels = page.getByTestId("notify-channels");
    await channels.getByLabel("Service").selectOption("slack");
    await channels.getByLabel("Channel name").fill("#testimonials");
    await channels.getByLabel("Webhook URL").fill(fixtureUrl(hook));
    await channels.getByLabel("Posts for").selectOption({ label: "Notify Co" });
    await channels.getByRole("button", { name: "Add channel" }).click();
    const row = channels.getByTestId("notify-channel").filter({ hasText: "#testimonials" });
    await expect(row).toBeVisible();
    // The URL is masked once saved.
    await expect(row).not.toContainText(`slack-${RUN}`);

    await row.getByRole("button", { name: "Send test" }).click();
    await expect(row.getByTestId("notify-test-result")).toHaveText("Test message sent");
    await expect.poll(async () => (await fixtureRequests(hook, "POST")).length).toBe(1);

    const [id] = await seed(api, p.slug, [{ name: `Ada ${RUN}`, text: "Plaudit made collecting reviews painless.", rating: 5 }]);
    await expect.poll(async () => (await fixtureRequests(hook, "POST")).length, { timeout: 20_000 }).toBe(2);
    const posted = (await fixtureRequests(hook, "POST"))[1];
    expect(posted.body).toContain("Plaudit made collecting reviews painless.");
    expect(posted.body).toContain("★★★★★");
    const link = `${baseURL}/admin/projects/${p.id}?open=${id}`;
    expect(posted.body).toContain(link);

    const mail = await waitForMail(E2E_ADMIN.email, new RegExp(`Subject: New testimonial for Notify Co \\(5/5\\) from Ada ${RUN}`));
    expect(mail).toContain("Plaudit made collecting reviews painless.");
    expect(mail).toContain(link);

    // The approve link opens the testimonial, ready to approve.
    await page.goto(link);
    const drawer = page.getByRole("dialog");
    await expect(drawer).toContainText(`Ada ${RUN}`);

    // Clean up so other specs' submissions don't post here.
    await api.delete(`/api/admin/notification-channels/${(await (await api.get("/api/admin/notification-channels")).json()).channels.find((c: { name: string }) => c.name === "#testimonials").id}`);
  });

  test("INT-02 a form can choose which channels hear about it", async ({ page, baseURL }) => {
    await resetFixtures();
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Per Form", `perform-${RUN}`);
    const a = await (await api.post("/api/admin/notification-channels", { data: { type: "discord", name: "Team A", target: fixtureUrl(`/a-${RUN}`), projectId: p.id } })).json();
    const b = await (await api.post("/api/admin/notification-channels", { data: { type: "slack", name: "Team B", target: fixtureUrl(`/b-${RUN}`), projectId: p.id } })).json();
    const forms = (await (await api.get(`/api/admin/projects/${p.id}/forms`)).json()).forms as { id: string; isDefault: boolean }[];
    const form = forms.find((f) => f.isDefault)!;

    await signIn(page);
    await page.goto(`/admin/projects/${p.id}/forms/${form.id}`);
    await page.getByRole("tab", { name: "Settings" }).click();
    const section = page.getByTestId("form-notify");
    await section.getByLabel(/Only the channels I tick/).check();
    await section.getByLabel(/Team A/).check();
    await page.getByTestId("save-form").click();
    await expect(page.getByTestId("save-form")).toHaveText("Saved");

    await seed(api, p.slug, [{ name: "Bo", text: "Only team A hears this.", rating: 4 }]);
    await expect.poll(async () => (await fixtureRequests(`/a-${RUN}`, "POST")).length, { timeout: 20_000 }).toBe(1);
    expect(await fixtureRequests(`/b-${RUN}`, "POST")).toHaveLength(0);
    for (const c of [a.channel, b.channel]) await api.delete(`/api/admin/notification-channels/${c.id}`);
  });
});

test("INT-02 a webhook's URL, events, project and form can be edited", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Hook Edit", `hookedit-${RUN}`);
  const created = await (await api.post("/api/admin/webhooks", { data: { url: `https://example.com/hook-${RUN}`, events: ["testimonial.created"] } })).json();
  await signIn(page);
  await page.goto("/admin/settings");
  const card = page.getByTestId("webhook").filter({ hasText: `hook-${RUN}` });
  await card.getByRole("button", { name: "Edit" }).click();
  const editor = card.getByTestId("webhook-editor");
  await editor.getByLabel("Endpoint URL").fill(`https://example.com/edited-${RUN}`);
  await editor.getByLabel("Project").selectOption({ label: "Hook Edit" });
  await editor.locator("label", { hasText: /^Form/ }).locator("select").selectOption({ index: 1 });
  await editor.getByLabel("testimonial.approved").check();
  await editor.getByRole("button", { name: "Save webhook" }).click();
  await expect(page.getByTestId("webhook").filter({ hasText: `edited-${RUN}` })).toContainText("testimonial.created, testimonial.approved");

  const hook = ((await (await api.get("/api/admin/webhooks")).json()).webhooks as { id: string; url: string; events: string[]; projectId: string; formId: string | null }[]).find(
    (h) => h.id === created.webhook.id,
  )!;
  expect(hook.url).toBe(`https://example.com/edited-${RUN}`);
  expect(hook.events).toEqual(["testimonial.created", "testimonial.approved"]);
  expect(hook.projectId).toBe(p.id);
  expect(hook.formId).not.toBeNull();
  await api.delete(`/api/admin/webhooks/${hook.id}`);
});

test("INT-01 email settings are each person's own and start off", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const before = await (await api.get("/api/admin/me/notifications")).json();
  expect(before.notifications).toMatchObject({ newTestimonial: "off", weeklyPending: false, importSummary: false, monthlyReport: false });
  await signIn(page);
  await page.goto("/admin/settings");
  const prefs = page.getByTestId("notify-prefs");
  await prefs.getByLabel("Weekly reminder of testimonials waiting for review (Mondays)").check();
  await prefs.getByLabel("New testimonials").selectOption("daily");
  await prefs.getByRole("button", { name: "Save email settings" }).click();
  await expect(prefs.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("notify-prefs").getByLabel("New testimonials")).toHaveValue("daily");
  await expect(page.getByTestId("notify-prefs").getByLabel("Weekly reminder of testimonials waiting for review (Mondays)")).toBeChecked();
});
