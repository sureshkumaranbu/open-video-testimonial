import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminApi, createProject, hostPage, seed, signIn, startHostServer, useFreshIp } from "./helpers";

/**
 * Project settings (TEAM-04): changing the link keeps old links working,
 * deleting needs the name typed out, the brand kit and logo, the tags
 * manager, and the page at phone width.
 */

const RUN = Date.now().toString(36);
let n = 0;
const slug = (name: string) => `ps-${name}-${RUN}-${++n}`;

// A real 1×1 PNG, so the logo preview has something to draw.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// FontField's radios are named with their "Ag" sample too ("AgSerif"); this skips "AgSans serif".
const SERIF = /Serif$/;

const settingsUrl = (id: string) => `/admin/projects/${id}/settings`;

async function openSettings(page: Page, id: string) {
  await page.goto(settingsUrl(id));
  await expect(page.getByRole("heading", { name: "Project settings", level: 1 })).toBeVisible();
}

async function tagsOf(api: APIRequestContext, id: string) {
  const res = await api.get(`/api/admin/projects/${id}/tags`);
  expect(res.ok()).toBe(true);
  return (await res.json()).tags as { name: string; count: number }[];
}

async function fitsThePhone(page: Page) {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
}

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("TEAM-04 the Project settings tab opens the settings page", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Tab Co", slug("tab"));
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Project settings" }).click();
  await expect(page).toHaveURL(new RegExp(`${settingsUrl(p.id)}$`));
  await expect(page.getByTestId("project-settings")).toBeVisible();

  // Details save, and the breadcrumb follows the new name.
  await page.getByLabel("Project name").fill("Tab Co Renamed");
  await page.getByLabel(/^Website/).fill("https://tab.example");
  await page.getByLabel(/^Kind of business/).selectOption("agency");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("settings-toast")).toContainText("Details saved");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Tab Co Renamed");
  const saved = (await (await api.get(`/api/admin/projects/${p.id}`)).json()).project;
  expect(saved).toMatchObject({ name: "Tab Co Renamed", website: "https://tab.example", businessType: "agency" });
});

test.describe("changing the link", () => {
  let host: Awaited<ReturnType<typeof startHostServer>>;
  test.beforeAll(async () => {
    host = await startHostServer();
  });
  test.afterAll(async () => host?.close());

  test("TEAM-04 slug change: old /c, ?r= request links, the widget and the iframe keep working", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const oldSlug = slug("old");
    const newSlug = slug("new");
    const p = await createProject(api, "Rename Co", oldSlug);
    await seed(api, oldSlug, [{ name: "Wanda Widget", text: "Still showing after the rename.", status: "approved" }]);
    const made = await api.post(`/api/admin/projects/${p.id}/requests`, { data: { recipients: `Rae Renamed, rae+${RUN}@example.com, Raeco` } });
    expect(made.status()).toBe(201);
    const requestLink = (await made.json()).created[0].link as string;
    expect(requestLink).toContain(`/c/${oldSlug}?r=`);

    await signIn(page);
    await openSettings(page, p.id);
    const link = page.getByTestId("project-link");
    await expect(link.getByText("None yet.")).toBeVisible();
    await link.getByLabel("Link name").fill(newSlug);
    await link.getByRole("button", { name: "Change link…" }).click();
    const dialog = page.getByTestId("change-link-dialog");
    await expect(dialog).toContainText(`/c/${newSlug}`);
    await expect(dialog).toContainText("Old links keep working");
    await dialog.getByRole("button", { name: "Change link", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("settings-toast")).toContainText("Link changed. Old links still work.");
    await expect(link.getByTestId("redirect-row")).toHaveCount(1);
    await expect(link.getByTestId("redirect-row")).toContainText(`/c/${oldSlug}`);
    await expect(link.getByTestId("collect-link").getByRole("textbox")).toHaveValue(`${baseURL}/c/${newSlug}`);

    // A permanent redirect that keeps the query.
    const res = await api.get(`/c/${oldSlug}?utm_source=mail`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toMatch(new RegExp(`/c/${newSlug}\\?utm_source=mail$`));
    for (const path of [`/wall/${oldSlug}?theme=dark`, `/embed/${oldSlug}?theme=dark`]) {
      expect((await api.get(path, { maxRedirects: 0 })).status(), path).toBe(308);
    }
    // The widget feed answers the old slug directly.
    const feed = await api.get(`/api/widget/${oldSlug}`, { maxRedirects: 0 });
    expect(feed.status()).toBe(200);
    expect((await feed.json()).project.slug).toBe(newSlug);

    // The emailed request link still opens a prefilled form.
    await page.goto(requestLink);
    await expect(page).toHaveURL(new RegExp(`/c/${newSlug}\\?r=`));
    await expect(page.getByLabel("Your name")).toHaveValue("Rae Renamed");
    await expect(page.getByLabel("Company")).toHaveValue("Raeco");

    // Embeds pasted before the rename, on someone else's site.
    await page.setExtraHTTPHeaders({});
    const appOrigin = new URL(baseURL!).origin;
    host.pages["/old-widget.html"] = hostPage("old widget", `<script src="${appOrigin}/widget.js" data-project="${oldSlug}" async></script>`);
    await page.goto(`${host.url}/old-widget.html`);
    const w = page.locator("[data-plaudit-widget]");
    await expect(w).toHaveAttribute("data-plaudit-ready", "1");
    await expect(w.locator("article.c")).toHaveCount(1);
    await expect(w.getByText("Wanda Widget")).toBeVisible();

    const frameId = `plaudit-${oldSlug}`;
    host.pages["/old-iframe.html"] = hostPage(
      "old iframe",
      `<iframe src="${baseURL}/embed/${oldSlug}?theme=light" title="Testimonials" style="width:100%;border:0;height:400px" id="${frameId}"></iframe>
<script>addEventListener("message",function(e){if(e.data&&e.data.type==="plaudit:resize"&&e.data.slug==="${oldSlug}"){document.getElementById("${frameId}").style.height=e.data.height+"px"}})</script>`,
    );
    await page.goto(`${host.url}/old-iframe.html`);
    const frame = page.frameLocator(`#${frameId}`);
    await expect(frame.getByText("Wanda Widget")).toBeVisible();
    const contentHeight = await frame.locator("#plaudit-embed").evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
    await expect.poll(() => page.locator(`#${frameId}`).evaluate((el) => (el as HTMLElement).style.height)).toBe(`${contentHeight}px`);
  });

  test("TEAM-04 removing an old link, and a slug another project holds", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const first = slug("first");
    const taken = await createProject(api, "Taken Co", slug("taken"));
    const p = await createProject(api, "Remove Co", first);
    expect((await api.post(`/api/admin/projects/${p.id}/slug`, { data: { slug: slug("second") } })).status()).toBe(200);

    await signIn(page);
    await openSettings(page, p.id);
    const link = page.getByTestId("project-link");
    await link.getByLabel("Link name").fill(taken.slug);
    await link.getByRole("button", { name: "Change link…" }).click();
    await expect(link.getByRole("alert")).toHaveText(`Another project already uses “${taken.slug}”. Pick a different link.`);

    await link.getByRole("button", { name: `Remove old link /c/${first}` }).click();
    const dialog = page.getByTestId("remove-link-dialog");
    await expect(dialog).toContainText("will stop working");
    await dialog.getByRole("button", { name: "Remove link" }).click();
    await expect(link.getByTestId("redirect-row")).toHaveCount(0);
    expect((await api.get(`/c/${first}`, { maxRedirects: 0 })).status()).toBe(404);
  });
});

test("TEAM-04 typed delete removes the project and its links", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const s = slug("delete");
  const p = await createProject(api, "Delete Me Co", s);
  await seed(api, s, [{ name: "Gone Soon", text: "Bye.", status: "approved", tags: ["farewell"] }]);

  await signIn(page);
  await openSettings(page, p.id);
  const zone = page.getByTestId("danger-zone");
  await expect(zone.getByRole("link", { name: "Export everything" })).toHaveAttribute("href", `/admin/projects/${p.id}/data`);
  await zone.getByRole("button", { name: "Delete project…" }).click();
  const dialog = page.getByTestId("delete-project-dialog");
  const confirm = dialog.getByRole("button", { name: "Delete project" });
  await expect(confirm).toBeDisabled();
  const typed = dialog.getByLabel(/to confirm/);
  await typed.fill("delete me co");
  await expect(confirm).toBeDisabled();
  await typed.fill("Delete Me Co");
  await confirm.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Delete Me Co")).toHaveCount(0);

  expect((await api.get(`/api/admin/projects/${p.id}`)).status()).toBe(404);
  expect((await api.get(`/c/${s}`)).status()).toBe(404);
  expect((await api.get(`/api/widget/${s}`)).status()).toBe(404);
  // The API needs the name too.
  const other = await createProject(api, "Keep Me Co", slug("keep"));
  const refused = await api.delete(`/api/admin/projects/${other.id}`, { data: { confirm: "keep me" } });
  expect(refused.status()).toBe(400);
});

test("TEAM-04 brand kit: logo, colours and fonts save and come back", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Brand Co", slug("brand"));
  await signIn(page);
  await openSettings(page, p.id);
  const kit = page.getByTestId("brand-kit");

  await kit.getByLabel("Logo file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("settings-toast")).toContainText("Logo uploaded");
  const logo = kit.getByTestId("logo-preview");
  await expect(logo).toBeVisible();
  const src = await logo.getAttribute("src");
  expect(src).toMatch(/^\/api\/media\/images\/[0-9a-f-]{36}\.png$/);
  // Logos are public, like form logos.
  expect((await (await page.context().browser()!.newContext()).request.get(`${baseURL}${src}`)).status()).toBe(200);

  await kit.getByLabel("Primary", { exact: true }).fill("#3d63dd");
  await kit.getByLabel("Button text", { exact: true }).fill("#ffffff");
  await kit.getByRole("group", { name: "Heading font" }).getByRole("radio", { name: SERIF }).check();
  await expect(kit.getByTestId("brand-preview").locator(".ps-preview-link")).toHaveCSS("color", "rgb(61, 99, 221)");
  await kit.getByRole("button", { name: "Save brand kit" }).click();
  await expect(page.getByTestId("settings-toast")).toContainText("Brand kit saved");

  const brand = JSON.parse((await (await api.get(`/api/admin/projects/${p.id}`)).json()).project.brand);
  expect(brand).toEqual({ colors: { primary: "#3d63dd", buttonText: "#ffffff" }, fonts: { heading: "serif" } });

  await page.reload();
  await expect(kit.getByLabel("Primary", { exact: true })).toHaveValue("#3d63dd");
  await expect(kit.getByRole("group", { name: "Heading font" }).getByRole("radio", { name: SERIF })).toBeChecked();
  await expect(kit.getByTestId("logo-preview")).toBeVisible();

  // A bad file is refused with a reason; removing the logo deletes it.
  await kit.getByLabel("Logo file").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
  await expect(kit.getByRole("alert")).toBeVisible();
  await kit.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByTestId("settings-toast")).toContainText("Logo removed");
  await expect(kit.getByTestId("logo-preview")).toHaveCount(0);
  expect((await api.get(src!)).status()).toBe(404);
});

test("TEAM-04 tags manager: rename, merge and delete across testimonials", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const s = slug("tags");
  const p = await createProject(api, "Tag Co", s);
  await seed(api, s, [
    { name: "Pat Pricing", text: "Fair price.", tags: ["pricing", "home"] },
    { name: "Cass Cost", text: "Worth it.", tags: ["cost"] },
    { name: "Hal Home", text: "Lovely.", tags: ["home"] },
  ]);

  await signIn(page);
  await openSettings(page, p.id);
  const tags = page.getByTestId("tags-manager");
  await expect(tags.getByTestId("tag-row")).toHaveCount(3);
  await expect(tags.locator('[data-tag="home"]')).toContainText("2 testimonials");

  // Rename.
  await tags.getByRole("button", { name: "Rename pricing" }).click();
  await tags.getByLabel("New name for “pricing”").fill("value");
  await tags.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("settings-toast")).toContainText("Renamed “pricing” to “value”");
  await expect(tags.locator('[data-tag="value"]')).toBeVisible();

  // Renaming onto a tag that exists says to merge instead.
  await tags.getByRole("button", { name: "Rename cost" }).click();
  await tags.getByLabel("New name for “cost”").fill("value");
  await tags.getByRole("button", { name: "Save", exact: true }).click();
  await expect(tags.getByRole("alert")).toHaveText("There's already a tag called “value”. Merge the two tags instead.");
  await tags.getByRole("button", { name: "Cancel" }).click();

  // Merge.
  await tags.getByRole("checkbox", { name: "value", exact: true }).check();
  await tags.getByRole("checkbox", { name: "cost", exact: true }).check();
  await page.getByTestId("tags-bulk").getByRole("button", { name: "Merge…" }).click();
  const merge = page.getByTestId("merge-tags-dialog");
  await merge.getByLabel("Merged tag name").fill("worth");
  await merge.getByRole("button", { name: "Merge tags" }).click();
  await expect(page.getByTestId("settings-toast")).toContainText("Merged into “worth”");
  expect(await tagsOf(api, p.id)).toEqual([
    { name: "home", count: 2 },
    { name: "worth", count: 2 },
  ]);

  // Delete.
  await tags.getByRole("button", { name: "Delete home" }).click();
  const del = page.getByTestId("delete-tag-dialog");
  await expect(del).toContainText("It comes off 2 testimonials");
  await del.getByRole("button", { name: "Delete tag" }).click();
  await expect(tags.getByTestId("tag-row")).toHaveCount(1);
  expect(await tagsOf(api, p.id)).toEqual([{ name: "worth", count: 2 }]);

  const testimonials = (await (await api.get(`/api/admin/projects/${p.id}`)).json()).testimonials as { authorName: string; tags: string[] }[];
  expect(Object.fromEntries(testimonials.map((t) => [t.authorName, t.tags]))).toEqual({
    "Pat Pricing": ["worth"],
    "Cass Cost": ["worth"],
    "Hal Home": [],
  });
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("TEAM-04 project settings fit a 375px screen", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const s = slug("long-project-link-name");
    const p = await createProject(api, "Phone Co", s);
    await seed(api, s, [{ name: "Tia Tags", text: "Tagged.", tags: ["a-long-tag-name-for-phones", "short"] }]);
    expect((await api.post(`/api/admin/projects/${p.id}/slug`, { data: { slug: `${s}-2` } })).status()).toBe(200);

    await signIn(page);
    await openSettings(page, p.id);
    await fitsThePhone(page);
    for (const id of ["project-details", "project-link", "brand-kit", "tags-manager", "danger-zone"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(375);
    }

    // The dialogs fit too.
    await page.getByTestId("project-link").getByLabel("Link name").fill(`${s}-3`);
    await page.getByRole("button", { name: "Change link…" }).click();
    const dialog = page.getByTestId("change-link-dialog");
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await fitsThePhone(page);
  });
});
