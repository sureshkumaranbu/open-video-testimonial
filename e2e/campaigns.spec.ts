import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { adminApi, createProject, freshIp, shot, signIn, useFreshIp, waitForMail } from "./helpers";
import { E2E_ADMIN } from "../playwright.config";

/**
 * Campaigns (M9): the dashboard, the emails people get, the links in them and
 * auto-collect. The test server writes emails to .e2e-data/mail-outbox
 * (MAIL_OUTBOX=true), so these skip against servers that really send mail.
 */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page, baseURL }) => {
  await useFreshIp(page);
  const system = await (await (await adminApi(baseURL!)).get("/api/admin/system")).json();
  test.skip(system.email.mode !== "outbox", "needs MAIL_OUTBOX=true to read emails");
});

type Campaign = { id: string };

/** A campaign through the dashboard's own API, with settings and people, optionally started. */
async function seedCampaign(api: APIRequestContext, projectId: string, name: string, o: { patch?: object; people?: string; start?: boolean } = {}) {
  const res = await api.post(`/api/admin/projects/${projectId}/campaigns`, { data: { name } });
  expect(res.status(), await res.text()).toBe(201);
  const { campaign } = (await res.json()) as { campaign: Campaign };
  if (o.patch) expect((await api.patch(`/api/admin/campaigns/${campaign.id}`, { data: o.patch })).ok()).toBe(true);
  if (o.people) expect((await api.post(`/api/admin/campaigns/${campaign.id}/recipients`, { data: { source: "paste", text: o.people } })).status()).toBe(201);
  if (o.start) expect((await api.patch(`/api/admin/campaigns/${campaign.id}`, { data: { status: "active" } })).ok()).toBe(true);
  return campaign;
}

const linkIn = (mail: string, path: string) => new RegExp(`http://\\S+/${path}/[\\w.-]+`).exec(mail)?.[0] ?? "";

test("REQ-01 REQ-02 REQ-03 REQ-06 a campaign from empty: wording, live preview, test send with the sender check, and an import report", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Campaign Co", `camp-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Campaigns", level: 1 })).toBeVisible();
  await expect(page.getByTestId("campaigns-empty")).toBeVisible();

  await page.getByLabel("New campaign name").fill("Spring customers");
  await page.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByRole("heading", { name: "Spring customers", level: 1 })).toBeVisible();
  await expect(page.getByTestId("campaign-status")).toHaveText("Draft");
  await expect(page.getByTestId("funnel-recipients")).toHaveText("0");

  // A new campaign opens on its email, with our default wording and a live preview.
  await expect(page.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("preview-subject")).toHaveText("Sam, would you share a few words about Campaign Co?");
  await page.getByLabel("Subject").fill("{{first_name}}, a minute for {{project}}?");
  await page.getByLabel("Button text").fill("Record a quick one");
  await page.getByLabel("Sender name").fill("Rae at Campaign Co");
  await expect(page.getByTestId("preview-subject")).toHaveText("Sam, a minute for Campaign Co?");
  await expect(page.getByTestId("campaign-preview")).toContainText("Rae at Campaign Co <");
  await expect(page.frameLocator('[data-testid="preview-frame"]').getByRole("link", { name: "Record a quick one" })).toBeVisible();
  await page.getByRole("button", { name: "Plain text" }).click();
  await expect(page.getByTestId("preview-text")).toContainText("No thanks?");
  await expect(page.getByTestId("campaign-unsaved")).toBeVisible();

  // Custom reminder days.
  await page.getByLabel("Reminder 2, days after the invitation").fill("10");
  await page.getByRole("button", { name: "Add a reminder" }).click();
  await page.getByLabel("Reminder 3, days after the invitation").fill("21");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("campaign-email-form").getByRole("status")).toHaveText("Saved");
  await expect(page.getByTestId("campaign-unsaved")).toHaveCount(0);

  // The test send goes to the signed-in member and reports the sender check (never blocking).
  await page.getByTestId("send-test").click();
  const result = page.getByTestId("campaign-test-result");
  await expect(result).toContainText(`to ${E2E_ADMIN.email}`);
  await expect(page.getByTestId("sender-auth")).toContainText("Sender check for");
  const test1 = await waitForMail(E2E_ADMIN.email, /Subject: \[Test\] Sam, a minute for Campaign Co\?/);
  expect(test1).toContain("Record a quick one");
  expect(test1).toContain("/d/test");

  // People: a CSV with a custom column, a bad row and a repeat; the report names each skipped line.
  await page.getByRole("tab", { name: /Recipients/ }).click();
  await expect(page.getByTestId("recipients-empty")).toBeVisible();
  await page.getByTestId("campaign-csv").setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`name,email,company,plan\nAda One,ada+${RUN}@example.com,Engines,Pro\nBad Row,not-an-address,,\nAda Again,ada+${RUN}@example.com,,\n`),
  });
  await page.getByRole("button", { name: "Add people" }).click();
  const report = page.getByTestId("import-report");
  await expect(report).toContainText("Added 1 person, skipped 2:");
  await expect(report.locator('li[data-reason="invalid"]')).toContainText("Line 3");
  await expect(report.locator('li[data-reason="duplicate"]')).toContainText(`Line 4: ada+${RUN}@example.com · Already in this campaign`);
  const row = page.getByTestId("recipient-row").filter({ hasText: "Ada One" });
  await expect(row).toHaveAttribute("data-stage", "not_sent");
  await expect(row).toContainText("the campaign is a draft");

  // One person by hand.
  await page.getByRole("button", { name: "One person" }).click();
  await page.getByLabel("Email", { exact: true }).fill(`bo+${RUN}@example.com`);
  await page.getByLabel("Name", { exact: true }).fill("Bo Hand");
  await page.getByRole("button", { name: "Add people" }).click();
  await expect(report).toContainText("Added 1 person.");
  await expect(page.getByTestId("funnel-recipients")).toHaveText("2");
  await shot(page, "campaign");

  // The list shows its numbers.
  await page.goto(`/admin/projects/${p.id}/campaigns`);
  const listed = page.getByTestId("campaign-row").filter({ hasText: "Spring customers" });
  await expect(listed).toHaveAttribute("data-status", "draft");
  await expect(listed.getByTestId("campaign-recipients")).toHaveText("2");
});

test("REQ-04 REQ-05 starting sends the invitations; the click, the form, the response, an open and a No thanks are tracked", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Track Co", `track-${RUN}`);
  const rae = `rae+${RUN}@example.com`;
  const sam = `sam+${RUN}@example.com`;
  const c = await seedCampaign(api, p.id, "Tracked", {
    patch: { subject: "{{first_name}}, how was {{project}}?", trackOpens: true },
    people: `Rae Tracked, ${rae}, Raeco\nSam Declines, ${sam}`,
  });

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/campaigns/${c.id}`);
  await page.getByRole("button", { name: "Start campaign" }).click();
  const dialog = page.getByTestId("campaign-start-dialog");
  await expect(dialog).toContainText("2 people get the invitation now");
  await dialog.getByRole("button", { name: "Start sending" }).click();
  await expect(page.getByTestId("campaign-status")).toHaveText("Sending");
  await expect(page.getByTestId("recipient-row").filter({ hasText: "Rae Tracked" })).toHaveAttribute("data-stage", "sent", { timeout: 20_000 });
  await expect(page.getByTestId("funnel-sent")).toHaveText("2");

  const invite = await waitForMail(rae, /Subject: Rae, how was Track Co\?/);
  const click = linkIn(invite, "r");
  expect(click).not.toBe("");
  expect(linkIn(invite, "u")).not.toBe("");

  // The pixel (this campaign opted in) records an open.
  const pixel = linkIn(invite, "api/open");
  expect((await page.request.get(pixel)).headers()["content-type"]).toBe("image/gif");

  // The personal link goes through the click redirect to the prefilled form.
  await page.goto(click);
  await expect(page).toHaveURL(new RegExp(`/c/track-${RUN}\\?r=`));
  await expect(page.getByLabel("Your name")).toHaveValue("Rae Tracked");
  await expect(page.getByLabel("Company")).toHaveValue("Raeco");
  await page.getByLabel("Your testimonial").fill("Campaign emails that actually make sense.");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByTestId("withdraw-note")).toBeVisible();

  // Sam says no thanks: the page asks once (mail scanners open every link).
  const declineMail = await waitForMail(sam, /Subject: Sam, how was Track Co\?/);
  await page.goto(linkIn(declineMail, "d"));
  await expect(page.getByRole("heading", { name: "Not for you?" })).toBeVisible();
  await page.getByRole("button", { name: "No thanks" }).click();
  await expect(page.getByRole("status")).toContainText("won't get reminders");
  await page.reload();
  await expect(page.getByRole("heading", { name: "No problem" })).toBeVisible();

  await page.goto(`/admin/projects/${p.id}/campaigns/${c.id}`);
  await expect(page.getByTestId("recipient-row").filter({ hasText: "Rae Tracked" })).toHaveAttribute("data-stage", "submitted");
  await expect(page.getByTestId("recipient-row").filter({ hasText: "Sam Declines" })).toHaveAttribute("data-stage", "declined");
  for (const [stage, n] of [["opened", "1"], ["clicked", "1"], ["started", "1"], ["submitted", "1"], ["declined", "1"]]) {
    await expect(page.getByTestId(`funnel-${stage}`)).toHaveText(n);
  }
  // The response is marked as requested in the inbox, as from the Requests tab.
  await page.goto(`/admin/projects/${p.id}`);
  await expect(page.getByTestId("admin-testimonial").filter({ hasText: "Rae Tracked" }).getByText("Requested", { exact: true })).toBeVisible();
});

test("REQ-07 the incoming webhook and POST /api/v1/invites queue invites, with a delay; regenerating retires the old URL", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Hook Co", `hook-${RUN}`);
  const c = await seedCampaign(api, p.id, "Auto", { patch: { body: "Hi {{first_name}}, thanks for buying {{plan}}.\n\n{{link}}" }, start: true });

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/campaigns/${c.id}`);
  await page.getByRole("tab", { name: "Auto-collect" }).click();
  await expect(page.getByTestId("campaign-id").getByRole("textbox")).toHaveValue(c.id);
  await expect(page.getByTestId("webhook-state")).toHaveText("Off");
  await page.getByRole("button", { name: "Create webhook URL" }).click();
  const url = await page.getByTestId("webhook-url").getByRole("textbox").inputValue();
  expect(url).toMatch(/\/api\/hooks\/campaigns\/cwh_[\w-]{32}$/);
  await expect(page.getByTestId("webhook-state")).toHaveText("On");

  // A shop or automation tool posts JSON; no session, no API key.
  const outside = await pwRequest.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const now = await outside.post(url, { data: { email: `kim+${RUN}@example.com`, name: "Kim Hook", plan: "the Pro plan" } });
  expect(now.status(), await now.text()).toBe(202);
  expect((await waitForMail(`kim+${RUN}@example.com`, /Subject: /)).replace(/=\r?\n/g, "")).toContain("Hi Kim, thanks for buying the Pro plan.");
  const later = await outside.post(`${url}?delay=2`, { data: { email: `lou+${RUN}@example.com`, name: "Lou Later" } });
  expect(later.status()).toBe(202);
  expect((await outside.post(url, { data: { email: "nope" } })).status()).toBe(400);

  // The REST API, with a read-and-write key.
  const key = (await (await api.post("/api/admin/api-keys", { data: { name: `m9-${RUN}`, scope: "write" } })).json()).key as string;
  const viaApi = await outside.post(`${baseURL}/api/v1/invites`, {
    headers: { authorization: `Bearer ${key}` },
    data: { campaignId: c.id, email: `max+${RUN}@example.com`, name: "Max Api", delayDays: 3 },
  });
  expect(viaApi.status(), await viaApi.text()).toBe(201);
  expect((await viaApi.json()).data).toMatchObject({ email: `max+${RUN}@example.com`, stage: "queued" });

  await page.reload();
  await expect(page.getByRole("tab", { name: /Recipients/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("recipient-row").filter({ hasText: "Lou Later" })).toContainText("Scheduled for");
  await expect(page.getByTestId("recipient-row").filter({ hasText: "Max Api" })).toHaveAttribute("data-stage", "queued");
  await expect(page.getByTestId("recipient-row").filter({ hasText: "Kim Hook" })).toHaveAttribute("data-stage", "sent", { timeout: 20_000 });

  await page.getByRole("tab", { name: "Auto-collect" }).click();
  await page.getByRole("button", { name: "Regenerate URL" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Regenerate URL" }).click();
  await expect(page.getByTestId("webhook-url").getByRole("textbox")).not.toHaveValue(url);
  expect((await outside.post(url, { data: { email: `old+${RUN}@example.com` } })).status()).toBe(404);
  await outside.dispose();
});

test("REQ-01 the campaign page fits a 360 px phone", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Phone Co", `phone-${RUN}`);
  const c = await seedCampaign(api, p.id, "Small screens", { people: `Pat Phone, pat+${RUN}@example.com, A company with a long name Ltd` });
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page);
  for (const path of [`/admin/projects/${p.id}/campaigns`, `/admin/projects/${p.id}/campaigns/${c.id}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
  await page.getByRole("tab", { name: "Email" }).click();
  await expect(page.getByTestId("preview-subject")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
