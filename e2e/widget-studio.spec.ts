import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { adminApi, createProject, hostPage, seed, signIn, startHostServer, useFreshIp } from "./helpers";

/**
 * M4 studio (WP4.3): the widgets list, the studio's live preview (the real
 * widget.js, so it equals the embed), device sizes, manual order and pins,
 * and every share snippet working on a hostile cross-origin host.
 */

const RUN = Date.now().toString(36);
let host: Awaited<ReturnType<typeof startHostServer>>;

test.beforeAll(async () => {
  host = await startHostServer();
});
test.afterAll(async () => {
  await host.close();
});
test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

async function fixture(baseURL: string, name: string) {
  const api = await adminApi(baseURL);
  const project = await createProject(api, `${name} ${RUN}`, `${name.toLowerCase()}-${RUN}`);
  const ids = await seed(api, project.slug, [
    { name: "Ada Lovelace", text: "Ada says the setup took minutes.", rating: 5, status: "approved" },
    { name: "Grace Hopper", text: "Grace found the reports clear.", rating: 4, status: "approved" },
    { name: "Alan Turing", text: "Alan wanted more charts.", rating: 3, status: "approved" },
    { name: "Mary Somerville", text: "Mary shares it with her team.", rating: 5, status: "approved" },
  ]);
  return { api, project, ids };
}

/** Names on the cards a widget host shows (marquee copies are hidden from readers and left out). */
const names = (root: Locator) => root.locator("article.c:not([aria-hidden]) .n").allTextContents();

/** A page with no extra request headers, so cross-origin widget fetches need no CORS preflight. */
async function visitor(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

test("DISP-12 the widgets list creates with a layout hint, duplicates and deletes", async ({ page, baseURL }) => {
  const { project } = await fixture(baseURL!, "Wlist");
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/widgets`);
  await expect(page.getByTestId("widgets-empty")).toBeVisible();
  const form = page.getByTestId("new-widget");
  await form.getByLabel("New widget name").fill("Pricing proof");
  // DISP-15: the page it's for suggests a layout.
  await form.getByLabel("Where it goes").selectOption("pricing");
  await expect(page.getByTestId("placement-hint")).toHaveText("Recommended for a pricing page: rating badge or carousel.");
  await expect(form.getByLabel("Layout")).toHaveValue("badge");
  await form.getByRole("button", { name: "Create widget" }).click();
  await expect(page).toHaveURL(/\/widgets\/w_[a-z0-9]{12}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pricing proof" })).toBeVisible();
  await expect(page.getByTestId("layout-badge")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("layout-badge")).toContainText("Recommended here");

  await page.goto(`/admin/projects/${project.id}/widgets`);
  const rows = page.getByTestId("widget-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Rating badge");
  await expect(rows.first()).toContainText("Pricing page");
  await rows.first().getByRole("button", { name: "Duplicate" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Pricing proof (copy)");
  await rows.nth(1).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete widget" }).click();
  await expect(rows).toHaveCount(1);
});

test("DISP-01 a marquee with manual picks and pins, 4+ stars, dark and first names: the preview equals the embed", async ({ page, browser, baseURL }) => {
  const { api, project } = await fixture(baseURL!, "Demo");
  const created = await api.post(`/api/admin/projects/${project.id}/widgets`, { data: { name: "Home marquee", layout: "grid", placement: "home" } });
  const { widget } = await created.json();
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/widgets/${widget.id}`);
  const preview = page.getByTestId("widget-preview-host");
  await expect(preview).toHaveAttribute("data-plaudit-ready", "4");

  // Layout
  await page.getByTestId("layout-marquee").click();
  await expect(preview).toHaveAttribute("data-layout", "marquee");

  // Testimonials: hand-picked, in a chosen order, with a pin, and 4+ stars.
  await page.getByRole("tab", { name: "Testimonials" }).click();
  await page.getByTestId("selection-mode").getByRole("button", { name: "Hand-picked" }).click();
  const pickable = page.getByTestId("pickable-list");
  for (const n of ["Grace Hopper", "Alan Turing", "Ada Lovelace"]) await pickable.getByRole("button", { name: `Pick ${n}` }).click();
  const picked = page.getByTestId("picked-list");
  await expect(picked.locator("li")).toHaveCount(3);
  await picked.getByRole("button", { name: "Move Ada Lovelace up" }).click();
  await expect(picked.locator("li").nth(1)).toContainText("Ada Lovelace");
  await pickable.getByRole("button", { name: "Pin Ada Lovelace" }).click();
  await expect(page.getByTestId("pinned-list")).toContainText("Ada Lovelace");
  await page.getByTestId("filter-min-rating").selectOption("4");

  // Design: dark theme, first names only.
  await page.getByRole("tab", { name: "Design" }).click();
  await page.getByTestId("design-theme").getByRole("button", { name: "Dark" }).click();
  await page.getByTestId("design-firstNameOnly").getByRole("switch").check();

  // Alan (3 stars) is filtered out; Ada is pinned first, then Grace (the picked order).
  await expect.poll(() => names(preview)).toEqual(["Ada", "Grace"]);
  await expect(preview.locator(".w")).toHaveClass(/dark/);

  // Device sizes
  const frame = page.getByTestId("widget-preview");
  for (const d of ["Mobile", "Tablet", "Desktop"]) {
    await frame.getByRole("button", { name: d }).click();
    await expect(frame).toHaveAttribute("data-device", d.toLowerCase());
  }
  await page.getByTestId("preview-bg").getByRole("button", { name: "Dark page" }).click();
  await expect(page.locator(".ws-stage")).toHaveAttribute("data-bg", "dark");

  await page.getByTestId("save-widget").click();
  await expect(page.getByTestId("save-widget")).toHaveText("Saved");
  const previewHtml = await preview.evaluate((el) => el.shadowRoot!.querySelector(".w")!.outerHTML);

  // The same widget embedded on another site draws the same thing.
  const v = await visitor(browser);
  host.pages["/demo"] = hostPage("Demo", `<script src="${baseURL}/widget.js" data-widget="${widget.id}" async></script>`);
  await v.goto(`${host.url}/demo`);
  const embed = v.locator(`[data-plaudit-widget="${widget.id}"]`);
  await expect(embed).toHaveAttribute("data-plaudit-ready", "2");
  expect(await names(embed)).toEqual(["Ada", "Grace"]);
  const embedHtml = await embed.evaluate((el) => el.shadowRoot!.querySelector(".w")!.outerHTML);
  // Marquee speed is measured from the rendered width, so compare without it.
  const strip = (s: string) => s.replace(/--dur:\s*[\d.]+s;?/g, "");
  expect(strip(embedHtml)).toBe(strip(previewHtml));
  await expect(embed.locator(".w")).toHaveClass(/dark/);
  await v.context().close();
});

test("DISP-09 the script, iframe, hosted link and React snippets render on a hostile cross-origin host", async ({ page, browser, baseURL }) => {
  const { api, project } = await fixture(baseURL!, "Share");
  const { widget } = await (await api.post(`/api/admin/projects/${project.id}/widgets`, { data: { name: "Share me", layout: "list" } })).json();
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/widgets/${widget.id}?tab=share`);
  const value = (id: string) => page.getByTestId(id).locator("textarea, input").first().inputValue();
  const script = await value("snippet-script");
  const iframe = await value("snippet-iframe");
  const hosted = await value("snippet-hosted");
  const react = await value("snippet-react");
  const html = await value("snippet-html");
  expect(script).toBe(`<script src="${baseURL}/widget.js" data-widget="${widget.id}" async></script>`);
  expect(hosted).toBe(`${baseURL}/embed/${widget.id}`);
  expect(html).toBe(`${baseURL}/api/widget/${widget.id}/html`);
  await expect(page.getByTestId("email-developer")).toHaveAttribute("href", /^mailto:\?subject=/);

  // The React component's effect, run as written (JSX aside) against a plain element.
  const effect = /useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[id\]\);/.exec(react)![1].replace("ref.current", "document.getElementById('react-root')");
  const reactPage = `<div id="react-root"></div><script>(function(){var id=${JSON.stringify(widget.id)};${effect.replace(/const /g, "var ").replace(/return \(\) => s\.remove\(\);/, "")}})()</script>`;

  host.pages["/script"] = hostPage("Script", script);
  host.pages["/iframe"] = hostPage("Iframe", iframe);
  host.pages["/react"] = hostPage("React", reactPage);
  const v = await visitor(browser);

  await v.goto(`${host.url}/script`);
  await expect(v.locator(`[data-plaudit-widget="${widget.id}"]`)).toHaveAttribute("data-plaudit-ready", "4");

  await v.goto(`${host.url}/react`);
  await expect(v.locator(`#plaudit-${widget.id}`)).toHaveAttribute("data-plaudit-ready", "4");

  await v.goto(`${host.url}/iframe`);
  const frame = v.frameLocator(`iframe[data-plaudit-frame="${widget.id}"]`);
  await expect(frame.locator("#plaudit-root")).toHaveAttribute("data-plaudit-ready", "4");
  await expect(frame.getByText("Ada says the setup took minutes.")).toBeVisible();
  // /embed/w_… posts its height and the snippet grows the frame to fit.
  await expect.poll(async () => v.locator("iframe").evaluate((f) => parseInt((f as HTMLIFrameElement).style.height || "0", 10)), { timeout: 10_000 }).toBeGreaterThan(400);

  await v.goto(hosted);
  await expect(v.locator("#plaudit-root")).toHaveAttribute("data-plaudit-ready", "4");
  await v.context().close();
});

test("DISP-05 DISP-06 DISP-07 labels, the form button and the rating summary show in the preview", async ({ page, baseURL }) => {
  const { api, project } = await fixture(baseURL!, "Extras");
  await api.post(`/api/admin/projects/${project.id}/forms`, { data: { name: "Stories" } });
  const { widget } = await (await api.post(`/api/admin/projects/${project.id}/widgets`, { data: { name: "Extras", layout: "grid" } })).json();
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/widgets/${widget.id}?tab=settings`);
  const preview = page.getByTestId("widget-preview-host");
  await expect(preview).toHaveAttribute("data-plaudit-ready", "4");
  await page.getByTestId("aggregate-show").getByRole("switch").check();
  await expect(preview.locator(".agg")).toContainText("4.3");
  await expect(preview.locator(".agg")).toContainText("4 reviews");
  await page.getByTestId("cta-form").selectOption({ label: "Stories" });
  await page.getByTestId("cta-enabled").getByRole("switch").check();
  await expect(preview.getByRole("link", { name: "Leave a testimonial" })).toHaveAttribute("href", new RegExp(`/f/${project.slug}/stories`));
  await page.getByRole("tab", { name: "Labels" }).click();
  await page.getByTestId("label-cta").fill("Tell us your story");
  await page.getByTestId("label-reviews").fill("avis");
  await expect(preview.getByRole("link", { name: "Tell us your story" })).toBeVisible();
  await expect(preview.locator(".agg")).toContainText("4 avis");
});
