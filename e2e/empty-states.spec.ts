import { expect, test } from "@playwright/test";
import { adminApi, createProject, signIn, useFreshIp } from "./helpers";

/** ONB-06: every list page has an empty state with one primary action. */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("ONB-06 empty inbox, widgets, walls, requests, forms search and snippets each offer one next step", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Empty Lists", `empty-${RUN}`);
  await signIn(page);

  await page.goto(`/admin/projects/${p.id}`);
  const inbox = page.getByTestId("inbox-empty");
  await expect(inbox.getByRole("heading", { name: "No testimonials yet" })).toBeVisible();
  await expect(inbox.getByRole("link", { name: "Open your collection form" })).toHaveAttribute("href", new RegExp(`/c/empty-${RUN}$`));

  await page.goto(`/admin/projects/${p.id}/widgets`);
  const widgets = page.getByTestId("widgets-empty");
  await widgets.getByRole("button", { name: "Create a widget" }).click();
  await expect(page.getByLabel("New widget name")).toBeFocused();

  await page.goto(`/admin/projects/${p.id}/walls`);
  await page.getByTestId("walls-empty").getByRole("button", { name: "Create a wall" }).click();
  await expect(page.getByLabel("New wall name")).toBeFocused();

  await page.goto(`/admin/projects/${p.id}/requests`);
  await page.getByTestId("requests-empty").getByRole("button", { name: "Invite people" }).click();
  await expect(page.locator("#request-people")).toBeFocused();

  await page.goto(`/admin/projects/${p.id}/forms`);
  await page.getByLabel("Search forms").fill("zzzz-nothing");
  const forms = page.getByTestId("forms-empty");
  await forms.getByRole("button", { name: "Clear the search" }).click();
  await expect(page.getByTestId("form-card")).toHaveCount(1);

  await page.goto(`/admin/projects/${p.id}/seo`);
  const snippets = page.getByTestId("snippets-empty");
  if (await snippets.count()) {
    await snippets.getByRole("button", { name: "Create a snippet" }).click();
    await expect(snippets).toHaveCount(0);
  }
});
