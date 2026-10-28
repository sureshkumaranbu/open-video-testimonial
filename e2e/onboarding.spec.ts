import { expect, test } from "@playwright/test";
import { adminApi, fixtureRespond, fixtureUrl, resetFixtures, signIn, useFreshIp } from "./helpers";

/**
 * The first-run wizard (ONB-01..05), opened at /admin/welcome directly:
 * /admin never redirects there (D10). The fixture server stands in for the
 * owner's website; the brand scan reads it in the background (ONB-02).
 */

const RUN = Date.now().toString(36);

test.skip(process.env.E2E_SERVER_IN_CONTAINER === "true" || Boolean(process.env.E2E_BASE_URL), "Needs the suite's own server, which reaches the fixture server");

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

// The wizard's "Email me new testimonials" box is ticked by default: switch it off again for later specs.
test.afterEach(async ({ baseURL }) => {
  await resetFixtures();
  const api = await adminApi(baseURL!);
  await api.put("/api/admin/me/notifications", { data: { notifications: { newTestimonial: "off" } } });
});

test("ONB-01 the wizard finds 4 testimonials on the site, imports them as approved and sets up branded starter assets; the checklist shows 1/4", async ({ page, baseURL }) => {
  await signIn(page);
  // D10: the dashboard offers the wizard, it doesn't redirect to it.
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/welcome");
  const wizard = page.getByTestId("welcome-wizard");
  await wizard.getByLabel("Project name").fill(`Larkspur ${RUN}`);
  await wizard.getByLabel(/Your website/).fill(fixtureUrl("onboarding/site/"));
  await wizard.getByLabel("What do you sell?").selectOption("local");
  await expect(wizard.getByLabel(/Email me new testimonials/)).toBeChecked();
  await wizard.getByRole("button", { name: "Continue" }).click();

  // The brand scan runs in the background; the wizard follows it.
  const found = page.getByTestId("welcome-found");
  await expect(found.getByRole("heading")).toHaveText("We found 4 testimonials on your site", { timeout: 30_000 });
  await expect(found.getByTestId("welcome-brand")).toContainText("#2f6b4f");
  await expect(found.getByTestId("welcome-found-item")).toHaveCount(4);
  await expect(found).toContainText("Ada Lovelace");
  await expect(found).toContainText("Office manager, Engines Ltd");
  await found.getByRole("button", { name: "Clear" }).click();
  await expect(found.getByRole("button", { name: "Import 0 as approved" })).toBeDisabled();
  await found.getByRole("button", { name: "Select all" }).click();
  await found.getByRole("button", { name: "Import 4 as approved" }).click();

  const done = page.getByTestId("welcome-done");
  await expect(done).toContainText("4 testimonials imported", { timeout: 20_000 });
  await done.getByRole("button", { name: "Go to your project" }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  const projectId = page.url().split("/").pop()!;

  const list = page.getByTestId("get-started");
  await expect(list.getByTestId("get-started-progress")).toHaveText("1/4 done");
  await expect(list.getByTestId("get-started-collect")).toHaveAttribute("data-done", "true");

  // What the wizard made, through the API.
  const api = await adminApi(baseURL!);
  const detail = await (await api.get(`/api/admin/projects/${projectId}`)).json();
  const testimonials = detail.testimonials as { status: string; platform: string }[];
  expect(testimonials).toHaveLength(4);
  expect(testimonials.every((t) => t.status === "approved" && t.platform === "website")).toBe(true);
  const forms = (await (await api.get(`/api/admin/projects/${projectId}/forms`)).json()).forms as { isDefault: boolean; layout: string; config: { design: { primary?: string } } }[];
  const form = forms.find((f) => f.isDefault)!;
  expect(form.layout).toBe("steps");
  expect(form.config.design.primary).toBe("#2f6b4f");
  const walls = (await (await api.get(`/api/admin/projects/${projectId}/walls`)).json()).walls as { isMain: boolean; published: boolean }[];
  expect(walls).toEqual([expect.objectContaining({ isMain: true, published: true })]);
  const widgets = (await (await api.get(`/api/admin/projects/${projectId}/widgets`)).json()).widgets as { layout: string }[];
  expect(widgets.map((w) => w.layout).sort()).toEqual(["carousel", "grid"]);
  expect(detail.project.logoKey).toMatch(/^images\//);

  // The install step is a manual tick; skipping and undoing work too.
  await list.getByRole("button", { name: "I've added it" }).click();
  await expect(list.getByTestId("get-started-progress")).toHaveText("2/4 done");
  await list.getByRole("button", { name: "Skip: Customise a widget" }).click();
  await expect(list.getByTestId("get-started-widget")).toHaveAttribute("data-skipped", "true");
  await expect(list.getByRole("button", { name: "Hide this list" })).toHaveCount(0);
});

test("ONB-03 a site with nothing to find says so, and the project is still made", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/welcome");
  const wizard = page.getByTestId("welcome-wizard");
  await wizard.getByLabel("Project name").fill(`Empty ${RUN}`);
  await wizard.getByLabel(/Your website/).fill(fixtureUrl("onboarding/empty/"));
  await wizard.getByLabel(/Email me new testimonials/).uncheck();
  await wizard.getByRole("button", { name: "Continue" }).click();
  const found = page.getByTestId("welcome-found");
  await expect(found.getByRole("heading")).toHaveText("No testimonials found on your site", { timeout: 30_000 });
  await found.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("welcome-done")).toContainText(`Empty ${RUN} is ready`);
});

test("ONB-02 the brand scan shows its progress, and its colour and logo still land when the owner moves on first", async ({ page, baseURL }) => {
  // A slow robots.txt keeps the scan going long enough to leave it.
  await fixtureRespond({ path: "/robots.txt", status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nAllow: /\n", delayMs: 4000, times: 1 });
  await signIn(page);
  await page.goto("/admin/welcome");
  const wizard = page.getByTestId("welcome-wizard");
  await wizard.getByLabel("Project name").fill(`Later ${RUN}`);
  await wizard.getByLabel(/Your website/).fill(fixtureUrl("onboarding/site/"));
  await wizard.getByLabel(/Email me new testimonials/).uncheck();
  await wizard.getByRole("button", { name: "Continue" }).click();

  const scanning = page.getByTestId("welcome-scanning");
  await expect(scanning.getByTestId("welcome-scan-progress")).toBeVisible();
  await scanning.getByRole("button", { name: "Continue without waiting" }).click();
  const done = page.getByTestId("welcome-done");
  await expect(done).toContainText(`Later ${RUN} is ready`);
  await expect(done.getByTestId("welcome-scan-pending")).toBeVisible();
  // When the scan ends, what it found is offered here.
  const later = done.getByTestId("welcome-found-later");
  await expect(later).toContainText("We found 4 testimonials on your site", { timeout: 30_000 });
  await later.getByRole("button", { name: "Review them" }).click();
  await expect(page.getByTestId("welcome-found").getByTestId("welcome-found-item")).toHaveCount(4);

  // The brand is on the project whether or not anyone looked.
  const api = await adminApi(baseURL!);
  const projects = (await (await api.get("/api/admin/projects")).json()).projects as { id: string; name: string }[];
  const projectId = projects.find((p) => p.name === `Later ${RUN}`)!.id;
  const detail = await (await api.get(`/api/admin/projects/${projectId}`)).json();
  expect(detail.project.logoKey).toMatch(/^images\//);
  const forms = (await (await api.get(`/api/admin/projects/${projectId}/forms`)).json()).forms as { isDefault: boolean; config: { design: { primary?: string } } }[];
  expect(forms.find((f) => f.isDefault)!.config.design.primary).toBe("#2f6b4f");
});
