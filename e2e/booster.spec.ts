import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { adminApi, createProject, FIXTURES, signIn, useFreshIp } from "./helpers";

/**
 * M10 review booster (BOOST-01..05): build a page in the editor with the
 * live preview, the Google helper, draft then public; every visitor sees
 * every link; clicks are counted and redirect only to the stored link; the
 * QR code downloads as PNG and SVG with a logo and a print size; phones at
 * 360 px; no third-party request and no CSP violation anywhere.
 */

const RUN = Date.now().toString(36);
const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

function offSite(page: Page, origin: string) {
  const seen: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["data:", "blob:"].includes(u.protocol) && u.origin !== origin) seen.push(r.url());
  });
  return seen;
}

async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __csp?: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp!.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as Window & { __csp?: string[] }).__csp ?? []);
}

test("BOOST-01 BOOST-02 BOOST-03 the owner builds a page with the preview and the Google helper, and every visitor sees every link once it's public", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, `Bake ${RUN}`, `bake-${RUN}`);
  const origin = new URL(baseURL!).origin;
  const violations = await watchCsp(page);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/boosters`);
  await expect(page.getByTestId("boosters-empty")).toBeVisible();
  await page.getByLabel("New page name").fill("Reviews");
  await page.getByRole("button", { name: "Create page" }).click();
  await expect(page.getByTestId("booster-editor")).toBeVisible();
  await expect(page.getByTestId("booster-links-empty")).toBeVisible();

  // Google first, with its review link from the helper (no Places key in e2e: paste only, and it says so).
  await page.getByTestId("booster-add-link").click();
  const google = page.getByTestId("booster-link-row").nth(0);
  await expect(google.getByTestId("booster-link-platform")).toHaveValue("google");
  await google.getByText("Get your Google review link").click();
  await expect(google.getByTestId("google-no-key")).toContainText("GOOGLE_PLACES_API_KEY");
  await google.getByTestId("google-paste").fill("https://maps.app.goo.gl/abc");
  await google.getByRole("button", { name: "Use it" }).click();
  await expect(google.getByRole("alert")).toContainText("Short links");
  await google.getByTestId("google-paste").fill(`https://www.google.com/maps/search/?api=1&query=Bake&query_place_id=${PLACE_ID}`);
  await google.getByRole("button", { name: "Use it" }).click();
  await expect(google.getByTestId("booster-link-url")).toHaveValue(`https://search.google.com/local/writereview?placeid=${PLACE_ID}`);

  await page.getByTestId("booster-add-link").click();
  const second = page.getByTestId("booster-link-row").nth(1);
  await expect(second.getByTestId("booster-link-platform")).toHaveValue("trustpilot");
  await second.getByTestId("booster-link-url").fill("https://www.trustpilot.com/evaluate/bake.example");
  await page.getByTestId("booster-add-link").click();
  const third = page.getByTestId("booster-link-row").nth(2);
  await third.getByTestId("booster-link-platform").selectOption("custom");
  await third.getByTestId("booster-link-label").fill("Sign our guestbook");
  await third.getByTestId("booster-link-url").fill("javascript:alert(1)");

  // The preview is the real page, at phone width and at desktop width; a javascript: link never becomes a button.
  const preview = page.getByTestId("booster-preview");
  await expect(preview.locator(".bst-link")).toHaveCount(2);
  await preview.getByRole("button", { name: "Desktop" }).click();
  await expect(preview).toHaveAttribute("data-device", "desktop");

  // ...and it's refused on save.
  await page.getByTestId("save-booster").click();
  await expect(page.getByRole("alert").first()).toContainText("https://");
  await third.getByTestId("booster-link-url").fill("https://bake.example/guestbook");
  await expect(preview.locator(".bst-link")).toHaveCount(3);
  // Move the guestbook to the top with the arrows (drag works too).
  await third.getByRole("button", { name: "Move link 3 up" }).click();
  await page.getByTestId("booster-link-row").nth(1).getByRole("button", { name: "Move link 2 up" }).click();
  await expect(page.getByTestId("booster-link-row").nth(0).getByTestId("booster-link-label")).toHaveValue("Sign our guestbook");
  // Offering something for a review gets a warning.
  await page.getByTestId("booster-message").fill("Leave a review and get a discount!");
  await expect(page.getByTestId("booster-incentive-warning")).toBeVisible();
  await page.getByTestId("booster-message").fill("Thanks for visiting us.");
  await expect(page.getByTestId("booster-incentive-warning")).toHaveCount(0);
  await page.getByTestId("save-booster").click();
  await expect(page.getByTestId("save-booster")).toHaveText("Saved");

  // Still a draft: the public page is a 404.
  const url = `/b/${project.slug}/reviews`;
  expect((await page.request.get(url)).status()).toBe(404);
  await page.getByRole("tab", { name: "Share" }).click();
  // The switch saves straight away (it follows the server), so click rather than check.
  await page.getByTestId("booster-public").getByRole("switch").click();
  await expect(page.getByTestId("booster-status")).toHaveText("Public");
  expect(await violations()).toEqual([]);

  // Every visitor sees every link, in order, on a page well under 50 KB that loads nothing from elsewhere.
  const away = offSite(page, origin);
  const res = await page.goto(`${url}?rating=1`);
  expect(res!.status()).toBe(200);
  expect((await res!.body()).length).toBeLessThan(50 * 1024);
  await expect(page.locator(".bst-label")).toHaveText(["Sign our guestbook", "Review us on Google", "Review us on Trustpilot"]);
  await expect(page.getByRole("link", { name: "Review us on Google" })).toHaveAttribute("href", `/b/${project.slug}/reviews/go/${await page.locator(".bst-link").nth(1).getAttribute("data-link")}`);
  expect(await page.locator("script").count()).toBe(0);
  expect(away).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("BOOST-05 a click is counted for its link and day, redirects only to the stored link, and shows in the Clicks tab", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, `Clicks ${RUN}`, `clicks-${RUN}`);
  const { booster } = await (await api.post(`/api/admin/projects/${project.id}/boosters`, { data: { name: "Reviews" } })).json();
  const target = "https://review.example/acme";
  await api.patch(`/api/admin/boosters/${booster.id}`, { data: { published: true, links: [{ id: "g", platform: "google", label: "", url: target, formId: null }] } });
  // The review site isn't really visited: answer it here.
  await page.route("https://review.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Review site</title>" }));
  await page.goto(`/b/${project.slug}/reviews`);
  const reached = page.waitForRequest((r) => r.url() === target);
  await page.locator(".bst-link").click();
  await reached;

  // The redirect target is the stored link, whatever the request asks for.
  const hop = await api.get(`/b/${project.slug}/reviews/go/g?url=https://evil.example`, { maxRedirects: 0 });
  expect(hop.status()).toBe(302);
  expect(hop.headers().location).toBe(target);
  expect((await api.get(`/b/${project.slug}/reviews/go/nope?url=https://evil.example`, { maxRedirects: 0 })).status()).toBe(404);

  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/boosters/${booster.id}`);
  await page.getByRole("tab", { name: "Clicks" }).click();
  await expect(page.getByTestId("booster-clicks-total")).toHaveText("2");
  await expect(page.getByTestId("booster-clicks-row")).toContainText("Review us on Google");
});

test("BOOST-04 the QR code downloads as PNG and SVG, with the logo in the centre and a print size", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, `QR ${RUN}`, `qr-${RUN}`);
  const { booster } = await (await api.post(`/api/admin/projects/${project.id}/boosters`, { data: { name: "Reviews" } })).json();
  const logo = await api.post(`/api/admin/boosters/${booster.id}/logo`, {
    multipart: { image: { name: "logo.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(FIXTURES, "avatar.png")) } },
  });
  expect(logo.status()).toBe(200);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/boosters/${booster.id}`);
  await page.getByRole("tab", { name: "Share" }).click();
  await expect(page.getByTestId("qr-preview")).toBeVisible();
  await page.getByTestId("qr-logo").check();
  await expect(page.getByTestId("qr-preview")).toHaveAttribute("data-logo", "true");
  await page.getByTestId("qr-size").selectOption("6cm");

  const [png] = await Promise.all([page.waitForEvent("download"), page.getByTestId("qr-png").click()]);
  expect(png.suggestedFilename()).toBe("reviews-qr.png");
  const bytes = fs.readFileSync((await png.path())!);
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  // 709 × 709 px: 6 cm at 300 dpi (the IHDR width and height).
  expect(bytes.readUInt32BE(16)).toBe(709);
  expect(bytes.readUInt32BE(20)).toBe(709);

  const [svg] = await Promise.all([page.waitForEvent("download"), page.getByTestId("qr-svg").click()]);
  expect(svg.suggestedFilename()).toBe("reviews-qr.svg");
  const text = fs.readFileSync((await svg.path())!, "utf8");
  expect(text).toMatch(/^<svg[^>]+width="60mm" height="60mm"/);
  expect(text).toContain('<image href="data:image/png;base64,');
});

test("BOOST-01 the editor and the public page work at 360 px", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  const api = await adminApi(baseURL!);
  const project = await createProject(api, `Phone ${RUN}`, `phone-${RUN}`);
  const { booster } = await (await api.post(`/api/admin/projects/${project.id}/boosters`, { data: { name: "Reviews" } })).json();
  await api.patch(`/api/admin/boosters/${booster.id}`, {
    data: { published: true, links: [{ id: "a", platform: "tripadvisor", label: "A rather long button label for a small phone screen", url: "https://review.example/a", formId: null }] },
  });
  await page.goto(`/b/${project.slug}/reviews`);
  await expect(page.locator(".bst-link")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/boosters/${booster.id}`);
  await expect(page.getByTestId("booster-editor")).toBeVisible();
  for (const tab of ["Links", "Look", "Share", "Clicks"]) {
    await page.getByRole("tab", { name: tab }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), tab).toBeLessThanOrEqual(360);
  }
  await page.goto(`/admin/projects/${project.id}/boosters`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
