import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";

/**
 * One end-to-end story against the production build: create a project,
 * collect text + uploaded video + recorded video testimonials, moderate them,
 * then check the wall and both embed options on a page from another origin.
 */
test.describe.configure({ mode: "serial" });

const SLUG = `acme-${Date.now().toString(36)}`;
const FIXTURES = path.join(__dirname, "fixtures");
const SHOTS = process.env.UPDATE_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots") : null;

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  // A sticky header is drawn where the viewport is, so start full-page shots at the top.
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function openProject(page: Page) {
  await page.goto("/admin");
  await page.getByRole("link", { name: new RegExp(`/${SLUG}`) }).click();
  await expect(page.getByRole("heading", { name: "Acme Analytics" })).toBeVisible();
}

/** Resolves once the <video> plays (videos with a poster don't preload). */
async function expectVideoPlays(video: Locator) {
  await video.scrollIntoViewIfNeeded();
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  expect(await video.evaluate((v: HTMLVideoElement) => v.error)).toBeNull();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 })
    .toBeGreaterThan(0);
}

test("admin can sign in and create a project", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("Email", { exact: true }).fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/wrong email or password/i)).toBeVisible();

  await signIn(page);
  await page.getByLabel("Name").fill("Acme Analytics");
  await page.getByLabel("Link slug").fill(SLUG);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Acme Analytics" })).toBeVisible();
});

test("customer submits a text testimonial with a rating and photo", async ({ page }) => {
  await page.goto(`/c/${SLUG}`);
  await page.getByRole("radio", { name: "5 stars" }).click();
  await page.getByLabel("Your testimonial").fill("Plaudit-style walls doubled our demo bookings.");
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel(/^Email/).fill("ada@example.com");
  await page.getByLabel("Role / title").fill("CTO");
  await page.getByLabel("Company").fill("Analytical Engines");
  await page.getByLabel(/^Photo/).setInputFiles(path.join(FIXTURES, "avatar.png"));
  await page.getByLabel(/I agree/).check();
  await shot(page, "collection-page", true);
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status")).toContainText(/thank you/i);
});

test("form requires consent", async ({ page }) => {
  await page.goto(`/c/${SLUG}`);
  await page.getByLabel("Your testimonial").fill("Missing consent");
  await page.getByLabel("Your name").fill("No Consent");
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  // Native validation blocks submission; nothing is sent.
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await page.getByLabel(/I agree/).evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
});

test("customer uploads a video testimonial", async ({ page }) => {
  await page.goto(`/c/${SLUG}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expect(page.getByLabel("Your recording")).toBeVisible();
  await page.getByLabel("Your name").fill("Grace Hopper");
  await page.getByLabel("Company").fill("Navy Labs");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status")).toContainText(/thank you/i);
});

test("customer records a video in the browser (fake camera)", async ({ page }) => {
  await page.goto(`/c/${SLUG}`);
  await page.getByRole("radio", { name: "4 stars" }).click();
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: /Record with camera/ }).click();
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await page.getByRole("button", { name: /Start recording/ }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect(page.getByLabel("Your recording")).toBeVisible();
  await page.getByLabel("Your name").fill("Linus Recorder");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status")).toContainText(/thank you/i);
});

test("customer submits a testimonial that will be rejected", async ({ page }) => {
  await page.goto(`/c/${SLUG}`);
  await page.getByLabel("Your testimonial").fill("Buy cheap followers at spam.example");
  await page.getByLabel("Your name").fill("Spammy McSpam");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status")).toBeVisible();
});

test("admin approves, rejects, renames and tags", async ({ page }) => {
  await signIn(page);
  await openProject(page);
  const pending = page.getByTestId("admin-testimonial");
  await expect(pending).toHaveCount(4);

  const card = (name: string) => page.getByTestId("admin-testimonial").filter({ hasText: name });
  await card("Spammy McSpam").getByRole("button", { name: "Reject" }).click();
  await expect(card("Spammy McSpam")).toHaveCount(0);

  // Rename + tag before approving.
  const ada = card("Ada Lovelace");
  await ada.getByLabel("Display name").fill("Ada L.");
  await ada.getByLabel(/Tags/).fill("homepage, pricing");
  await ada.getByRole("button", { name: "Save" }).click();
  await expect(card("Ada L.").getByLabel(/Tags/)).toHaveValue("homepage, pricing");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "admin-dashboard", true);

  for (const name of ["Ada L.", "Grace Hopper", "Linus Recorder"]) {
    await card(name).getByRole("button", { name: "Approve" }).click();
    await expect(card(name)).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Approved" }).click();
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(3);
  await page.getByRole("button", { name: "Rejected" }).click();
  await expect(page.getByTestId("admin-testimonial")).toHaveCount(1);
  await expect(page.getByTestId("admin-testimonial")).toContainText("Spammy McSpam");
});

test("wall of love shows only approved testimonials and videos play", async ({ page }) => {
  const mediaErrors: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/media/") && r.status() >= 400) mediaErrors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`/wall/${SLUG}?theme=dark`);
  expect(await page.getByText("Ada L.").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(238, 240, 246)");
  await page.goto(`/wall/${SLUG}`);
  const cards = page.locator("article.testimonial");
  await expect(cards).toHaveCount(3);
  await expect(page.getByText("Ada L.")).toBeVisible();
  await expect(page.getByText("Spammy McSpam")).toHaveCount(0);
  await expect(page.getByText("ada@example.com")).toHaveCount(0);
  await expect(page.getByLabel("5 out of 5 stars")).toBeVisible();

  const videos = page.locator("article.testimonial video");
  await expect(videos).toHaveCount(2);
  await expectVideoPlays(videos.nth(0));
  await expectVideoPlays(videos.nth(1));
  await page.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "wall-of-love");
  expect(mediaErrors).toEqual([]);
});

test.describe("embeds on a third-party page", () => {
  let server: http.Server;
  let hostUrl = "";
  const pages: Record<string, string> = {};

  test.beforeAll(async () => {
    // A plain HTML page served from a different origin than the app.
    server = http.createServer((req, res) => {
      const body = pages[req.url ?? ""];
      res.writeHead(body ? 200 : 404, { "Content-Type": "text/html" });
      res.end(body ?? "not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
    hostUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  test("script and iframe snippets render approved testimonials in light and dark", async ({ page }) => {
    await signIn(page);
    await openProject(page);
    const scriptLight = await page.getByTestId("script-snippet").innerText();
    await page.getByRole("button", { name: "Dark" }).click();
    const scriptDark = await page.getByTestId("script-snippet").innerText();
    const iframeDark = await page.getByTestId("iframe-snippet").innerText();
    expect(scriptLight).toContain('data-theme="light"');
    expect(scriptDark).toContain('data-theme="dark"');

    const html = (title: string, bg: string, snippet: string) =>
      `<!doctype html><html><head><title>${title}</title>
       <style>body{font-family:Georgia,serif;background:${bg};margin:24px} *{color:red}</style></head>
       <body><h2 style="color:${bg === "#fff" ? "#000" : "#fff"}">${title}</h2>${snippet}</body></html>`;
    pages["/light.html"] = html("Customer site (light)", "#fff", scriptLight);
    pages["/dark.html"] = html("Customer site (dark)", "#0b0d0c", scriptDark);
    pages["/iframe.html"] = html("Customer site (iframe)", "#0b0d0c", iframeDark);

    for (const theme of ["light", "dark"] as const) {
      await page.goto(`${hostUrl}/${theme}.html`);
      const widget = page.locator(`[data-plaudit-widget="${SLUG}"]`);
      await expect(widget).toHaveAttribute("data-plaudit-ready", "3");
      const cards = widget.locator("article.c"); // Playwright pierces open shadow roots
      await expect(cards).toHaveCount(3);
      await expect(widget.getByText("Ada L.")).toBeVisible();
      await expect(widget.getByText("Spammy McSpam")).toHaveCount(0);
      // Host page CSS (`* {color:red}`) must not leak into the widget.
      const color = await widget.getByText("Ada L.").evaluate((el) => getComputedStyle(el).color);
      expect(color).not.toBe("rgb(255, 0, 0)");
      const bg = await cards.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(theme === "dark" ? "rgb(23, 27, 43)" : "rgb(255, 255, 255)");
      await expectVideoPlays(widget.locator("video").first());
      await widget.locator("video").first().evaluate((v: HTMLVideoElement) => v.pause());
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `embed-script-${theme}`);
    }

    await page.goto(`${hostUrl}/iframe.html`);
    const frame = page.frameLocator(`#plaudit-${SLUG}`);
    await expect(frame.locator("article.testimonial")).toHaveCount(3);
    await expect(frame.getByText("Spammy McSpam")).toHaveCount(0);
    // The embed posts its content height so the host can size the iframe to fit.
    const contentHeight = await frame
      .locator("#plaudit-embed")
      .evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
    await expect
      .poll(() => page.locator(`#plaudit-${SLUG}`).evaluate((el) => (el as HTMLElement).style.height))
      .toBe(`${contentHeight}px`);
    const themeAttr = await frame.locator("[data-theme]").first().getAttribute("data-theme");
    expect(themeAttr).toBe("dark");
    // Text must use the dark theme's light foreground, not the page default.
    expect(await frame.getByText("Ada L.").evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(238, 240, 246)",
    );
    await shot(page, "embed-iframe-dark");
  });
});
