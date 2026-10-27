import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminApi, createProject, FIXTURES, hostPage, seed, signIn, skipLinuxWebkitMedia, startHostServer, useFreshIp } from "./helpers";

/**
 * M12 video and sharing: trim, poster, replace and download in the drawer
 * (VID-01..04); a testimonial's own page (WALL-04); the image studio
 * (SHARE-01..03); custom widget CSS (DISP-08); wall favicon, analytics and
 * verification tags (WALL-07). No third-party request on public pages
 * unless the owner picks an analytics provider for a wall.
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

type Row = { mediaStatus: string; trimStartMs: number | null; trimEndMs: number | null; posterKey: string | null; posterAtMs: number | null; videoKey: string; videoOriginalKey: string; transcriptStatus: string };
const detail = async (api: APIRequestContext, id: string) => (await (await api.get(`/api/admin/testimonials/${id}/detail`)).json()).testimonial as Row;

function offSite(page: Page, origin: string) {
  const seen: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["data:", "blob:"].includes(u.protocol) && u.origin !== origin) seen.push(r.url());
  });
  return seen;
}

async function fitsAt360(page: Page) {
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
}

/** A converted video testimonial, approved, or a skip when this server has no ffmpeg. */
async function readyVideo(api: APIRequestContext, slug: string, name: string) {
  const system = await (await api.get("/api/admin/system")).json();
  test.skip(!system.ffmpeg, "ffmpeg isn't installed on this server");
  const [id] = await seed(api, slug, [{ name, video: true, status: "approved" }]);
  await expect.poll(async () => (await detail(api, id)).mediaStatus, { timeout: 60_000 }).toBe("ready");
  return id;
}

test("VID-01 VID-02 VID-04 the owner trims with the waveform and a preview, picks a poster frame, and downloads the original and the MP4", async ({ page, baseURL, browserName }) => {
  skipLinuxWebkitMedia(browserName);
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Trim ${RUN}`, `trim-${RUN}`);
  const id = await readyVideo(api, p.slug, "Tara Trim");
  const before = await detail(api, id);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?open=${id}`);
  const tools = page.getByTestId("video-tools");
  await expect(tools.getByTestId("video-state")).toContainText("The whole recording");

  // Trim: drag both handles with the keyboard (100 ms a step), preview, save.
  await tools.getByTestId("vt-trim").click();
  const panel = tools.getByTestId("trim-panel");
  await expect(panel.getByTestId("vt-waveform")).toBeVisible();
  await panel.getByTestId("trim-start").focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(panel.getByTestId("trim-start-value")).toHaveText("0:01.0");
  await panel.getByTestId("trim-end").focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await panel.getByTestId("trim-preview").click();
  await panel.getByTestId("trim-save").click();
  await expect(tools.getByTestId("vt-status")).toContainText("being made");
  await expect.poll(async () => (await detail(api, id)).mediaStatus, { timeout: 60_000 }).toBe("ready");
  const cut = await detail(api, id);
  expect(cut.trimStartMs).toBe(1000);
  expect(cut.trimEndMs).toBeGreaterThan(2000);
  expect(cut.videoOriginalKey).toBe(before.videoOriginalKey);
  expect(cut.videoKey).not.toBe(before.videoKey);
  await expect(tools.getByTestId("video-state")).toContainText("Trimmed: 0:01.0");
  await expect(page.getByTestId("history")).toContainText("trim start");

  // The trimmed-away original is no longer public; the cut is.
  const anon = await (await import("@playwright/test")).request.newContext({ baseURL });
  expect((await anon.get(`/api/media/${cut.videoOriginalKey}`)).status()).toBe(404);
  expect((await anon.get(`/api/media/${cut.videoKey}`)).status()).toBe(200);

  // Poster: scrub to a frame and use it.
  await tools.getByTestId("vt-poster").click();
  const poster = tools.getByTestId("poster-panel");
  await poster.getByTestId("poster-at").focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await poster.getByTestId("poster-use-frame").click();
  await expect(tools.getByTestId("vt-status")).toContainText("Poster updated");
  const framed = await detail(api, id);
  expect(framed.posterAtMs).toBe(500);
  expect(framed.posterKey).not.toBe(cut.posterKey);
  // …and that poster is what the public sees.
  const feed = await (await anon.get(`/api/widget/${p.slug}`)).json();
  expect(feed.testimonials[0].video.poster).toBe(`/api/media/${framed.posterKey}`);

  // Downloads: attachments for the owner only.
  const [original] = await Promise.all([page.waitForEvent("download"), tools.getByTestId("vt-download-original").click()]);
  expect(original.suggestedFilename()).toBe("tara-trim-original.webm");
  const [mp4] = await Promise.all([page.waitForEvent("download"), tools.getByTestId("vt-download-mp4").click()]);
  expect(mp4.suggestedFilename()).toBe("tara-trim-video.mp4");
  expect((await anon.get(`/api/admin/testimonials/${id}/download?file=original`)).status()).toBe(401);
  await anon.dispose();
});

test("VID-03 replacing the file reruns the pipeline and clears the trim", async ({ page, baseURL, browserName }) => {
  skipLinuxWebkitMedia(browserName);
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Swap ${RUN}`, `swap-${RUN}`);
  const id = await readyVideo(api, p.slug, "Sam Swap");
  await api.put(`/api/admin/testimonials/${id}/trim`, { data: { startMs: 500, endMs: 2500 } });
  await expect.poll(async () => (await detail(api, id)).mediaStatus, { timeout: 60_000 }).toBe("ready");
  const before = await detail(api, id);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?open=${id}`);
  const tools = page.getByTestId("video-tools");
  await tools.getByTestId("vt-replace").click();
  await tools.getByTestId("replace-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await tools.getByTestId("replace-send").click();
  await expect(tools.getByTestId("vt-status")).toContainText("Video replaced");
  await expect.poll(async () => (await detail(api, id)).mediaStatus, { timeout: 60_000 }).toBe("ready");
  const after = await detail(api, id);
  expect(after.trimStartMs).toBeNull();
  expect(after.videoOriginalKey).not.toBe(before.videoOriginalKey);
  expect((await api.get(`/api/media/${before.videoOriginalKey}`)).status()).toBe(404); // deleted
  await expect(tools.getByTestId("video-state")).toContainText("The whole recording");
  await expect(page.getByTestId("history")).toContainText("video file");
});

test("WALL-04 SHARE-03 a testimonial's own page: quote, person, CTA, share links, OG image and JSON-LD; 404 unless public; fits 360 px", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Page ${RUN}`, `page-${RUN}`);
  const [pub, pending] = await seed(api, p.slug, [
    { name: "Pia Page", text: "Plaudit made collecting stories easy.", rating: 5, status: "approved", email: "pia@example.com" },
    { name: "Nina Pending", text: "Not yet approved." },
  ]);
  const origin = new URL(baseURL!).origin;
  const off = offSite(page, origin);
  const res = await page.goto(`/t/${pub}`);
  expect(res!.status()).toBe(200);
  const card = page.getByTestId("testimonial-page");
  await expect(card).toContainText("Plaudit made collecting stories easy.");
  await expect(card).toContainText("Pia Page");
  await expect(page.getByTestId("tp-cta")).toHaveAttribute("href", `/wall/${p.slug}`);
  expect(await page.content()).not.toContain("pia@example.com");
  const x = await page.getByTestId("share-x").getAttribute("href");
  expect(x).toMatch(/^https:\/\/x\.com\/intent\/post\?text=.+&url=.+%2Ft%2F/);
  expect(await page.getByTestId("share-linkedin").getAttribute("href")).toContain("linkedin.com/sharing/share-offsite/?url=");
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld.review[0]).toMatchObject({ "@type": "Review", author: { name: "Pia Page" } });
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toContain(`/t/${pub}/opengraph-image`);
  const img = await page.request.get(new URL(og!).pathname);
  expect(img.headers()["content-type"]).toBe("image/png");
  await fitsAt360(page);
  expect(off).toEqual([]);

  for (const id of [pending, "00000000-0000-0000-0000-000000000000"]) {
    expect((await page.goto(`/t/${id}`))!.status()).toBe(404);
    expect((await page.request.get(`/t/${id}/opengraph-image`)).status()).toBe(404);
  }
  // Views were counted (cookielessly) for the public page only.
  await page.goto(`/t/${pub}`);
  await page.getByTestId("share-copy").click();
  await expect.poll(async () => (await (await api.get(`/api/admin/analytics/testimonial/${pub}`)).json()).report?.current?.views ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("SHARE-01 SHARE-02 SHARE-03 the studio makes an image from the drawer: template, size, override, export, ZIP, my template, share intent", async ({ page, baseURL, browserName }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Studio ${RUN}`, `studio-${RUN}`);
  const [a] = await seed(api, p.slug, [
    { name: "Stella Studio", text: "The studio turned our best quote into a post in a minute.", rating: 5, status: "approved" },
    { name: "Omar Other", text: "Support answered on a Sunday.", rating: 4, status: "approved" },
    { name: "Una Third", text: "We doubled our reviews.", rating: 5, status: "approved" },
  ]);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?open=${a}`);
  await page.getByTestId("create-image").click();
  await expect(page).toHaveURL(new RegExp(`/share\\?ids=${a}`));
  const preview = page.getByTestId("studio-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-width", "1080");

  // Wording for this image only, with a highlight; a story-sized Postcard.
  await page.getByTestId("override-text").fill("Our best quote became **a post in a minute**.");
  await page.locator('[data-template="postcard"]').click();
  await page.getByTestId("studio-size").selectOption("story");
  await expect(preview).toHaveAttribute("data-height", "1920");
  await page.getByTestId("studio-bg").getByRole("button", { name: "Pattern" }).click();
  await page.getByTestId("studio-pattern").selectOption("confetti");
  const src = await preview.getAttribute("src");
  await expect.poll(async () => preview.getAttribute("src")).not.toBe(src);

  const [png] = await Promise.all([page.waitForEvent("download"), page.getByTestId("studio-download").click()]);
  expect(png.suggestedFilename()).toBe("postcard-1080x1920.png");
  const bytes = fs.readFileSync((await png.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");

  await page.getByTestId("studio-format").getByRole("button", { name: "JPEG" }).click();
  const [jpg] = await Promise.all([page.waitForEvent("download"), page.getByTestId("studio-download").click()]);
  expect(jpg.suggestedFilename()).toBe("postcard-1080x1920.jpg");

  const [zip] = await Promise.all([page.waitForEvent("download"), page.getByTestId("studio-zip-sizes").click()]);
  expect(zip.suggestedFilename()).toBe("testimonial-images.zip");

  // The testimonial itself didn't change.
  const d = await (await api.get(`/api/admin/testimonials/${a}/detail`)).json();
  expect(d.testimonial.text).toBe("The studio turned our best quote into a post in a minute.");

  // Save as my template, and it's there after a reload.
  await page.getByTestId("studio-template-name").fill("Story confetti");
  await page.getByTestId("studio-template-save").click();
  await expect(page.getByTestId("studio-status")).toContainText("Saved “Story confetti”");
  await page.reload();
  await expect(page.getByTestId("studio-templates")).toContainText("Story confetti");

  // Three testimonials in a three-column template.
  for (const name of ["Omar Other", "Una Third"]) await page.getByTestId("studio-picker").locator("label", { hasText: name }).getByTestId("studio-pick").check();
  await page.locator('[data-template="trio"]').click();
  await expect(preview).toBeVisible();

  // Share to X: the image downloads, and X's own intent page opens with the testimonial's link.
  // Never reach the real X: popups belong to the context, so the route goes there.
  await page.context().route("https://x.com/**", (r) => r.fulfill({ status: 200, body: "intent" }));
  const [popup, shared] = await Promise.all([page.waitForEvent("popup"), page.waitForEvent("download"), page.getByTestId("studio-share-x").click()]);
  // A noopener popup can still be about:blank when the event fires; wait for its navigation.
  await popup.waitForURL(/^https:\/\/x\.com\/intent\/post\?text=.+&url=.+%2Ft%2F/);
  expect(shared.suggestedFilename()).toMatch(/^trio-.+\.png$/);
  await popup.close();

  if (browserName === "chromium") {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("studio-copy").click();
    await expect(page.getByTestId("studio-status")).toContainText("Copied");
  }
  await fitsAt360(page);
});

test("SHARE-01 the studio's empty state when there's nothing to make images from", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Empty studio ${RUN}`, `empty-studio-${RUN}`);
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/share`);
  await expect(page.getByTestId("studio-empty")).toBeVisible();
});

test("DISP-08 custom CSS applies inside the widget's shadow root, in the preview and the embed, and never fetches elsewhere", async ({ page, baseURL, browser }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Css ${RUN}`, `css-${RUN}`);
  await seed(api, p.slug, [{ name: "Cass Style", text: "Styled just right.", rating: 5, status: "approved" }]);
  const { widget } = await (await api.post(`/api/admin/projects/${p.id}/widgets`, { data: { name: "Styled", layout: "list" } })).json();
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/widgets/${widget.id}`);
  await page.getByRole("tab", { name: "Design" }).click();
  await page.getByTestId("custom-css-input").fill("@import url(https://evil.example/x.css);\n.x .n{color:rgb(200, 0, 0)}\n.c{background:url(https://evil.example/t.gif)}");
  await expect(page.getByTestId("custom-css-cleaned")).toContainText(".x .n{color:rgb(200, 0, 0)}");
  const preview = page.getByTestId("widget-preview-host");
  const nameColour = () => preview.evaluate((el) => {
    const n = el.shadowRoot?.querySelector(".n");
    return n ? getComputedStyle(n).color : null;
  });
  await expect.poll(nameColour).toBe("rgb(200, 0, 0)");
  await page.getByTestId("save-widget").click();
  await expect(page.getByTestId("save-widget")).toHaveText("Saved");

  const v = await (await browser.newContext()).newPage();
  const off: string[] = [];
  v.on("request", (r) => {
    if (r.url().includes("evil.example")) off.push(r.url());
  });
  host.pages["/css"] = hostPage("Css", `<p class="n">Host text</p><script src="${baseURL}/widget.js" data-widget="${widget.id}" async></script>`);
  await v.goto(`${host.url}/css`);
  const embed = v.locator(`[data-plaudit-widget="${widget.id}"]`);
  await expect(embed).toHaveAttribute("data-plaudit-ready", "1");
  expect(await embed.evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector(".n")!).color)).toBe("rgb(200, 0, 0)");
  // Scoped: the host page's own .n isn't touched by the widget's CSS.
  expect(await v.locator("p.n").evaluate((el) => getComputedStyle(el).color)).not.toBe("rgb(200, 0, 0)");
  expect(off).toEqual([]);
  await v.context().close();
});

test("WALL-07 a wall's favicon, verification tags and opt-in analytics: only that provider, only on that wall", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, `Head ${RUN}`, `head-${RUN}`);
  await seed(api, p.slug, [{ name: "Hal Head", text: "Lovely.", status: "approved" }]);
  const mk = async (name: string) => (await (await api.post(`/api/admin/projects/${p.id}/walls`, { data: { name } })).json()).wall;
  const tracked = await mk("Tracked");
  const plain = await mk("Plain");
  await api.patch(`/api/admin/walls/${plain.id}`, { data: { published: true } });

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/walls/${tracked.id}`);
  await page.getByRole("tab", { name: "SEO" }).click();
  await page.getByTestId("wall-favicon").locator('input[type="file"]').setInputFiles(path.join(FIXTURES, "avatar.png"));
  await expect(page.getByTestId("wall-favicon").locator("img")).toBeVisible();
  await page.getByTestId("wall-analytics-provider").getByRole("button", { name: "Plausible" }).click();
  await expect(page.getByTestId("wall-analytics-note")).toContainText("Plausible will see this wall");
  await page.getByTestId("wall-plausible-domain").fill("example.com");
  await page.getByTestId("wall-verify-google").fill("goog_123-abc");
  await page.getByTestId("save-wall").click();
  await expect.poll(async () => (await (await api.get(`/api/admin/projects/${p.id}/walls`)).json()).walls.find((w: { id: string }) => w.id === tracked.id).config.head.plausibleDomain).toBe("example.com");
  await api.patch(`/api/admin/walls/${tracked.id}`, { data: { published: true } });

  const visitor = page;
  const plausible: string[] = [];
  await visitor.route("https://plausible.io/**", (r) => {
    plausible.push(r.request().url());
    return r.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  });
  const res = await visitor.goto(`/wall/${p.slug}/${tracked.slug}`);
  const csp = res!.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self' 'unsafe-inline' https://plausible.io");
  await expect(visitor.locator('script[src="https://plausible.io/js/script.js"]')).toHaveAttribute("data-domain", "example.com");
  await expect(visitor.locator('meta[name="google-site-verification"]')).toHaveAttribute("content", "goog_123-abc");
  // Next.js also lists the app's own favicon.ico; the wall's comes after it, so browsers use the wall's.
  const icons = await visitor.locator('link[rel="icon"]').evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  expect(icons.at(-1)).toMatch(/\/api\/media\/images\/.+\.png$/);
  await expect.poll(() => plausible.length).toBeGreaterThan(0);

  const other = await visitor.goto(`/wall/${p.slug}/${plain.slug}`);
  expect(other!.headers()["content-security-policy"]).not.toContain("plausible");
  await expect(visitor.locator('script[src*="plausible"]')).toHaveCount(0);
});
