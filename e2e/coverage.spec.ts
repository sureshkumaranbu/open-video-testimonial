import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";
import {
  adminApi,
  createProject,
  FIXTURES,
  hostPage,
  seed,
  SHOTS,
  signIn,
  startHostServer,
  useFreshIp,
} from "./helpers";

/**
 * Functional coverage of every surface, independent of flow.spec.ts: each
 * describe block creates its own projects (unique slugs) through the API or
 * the UI, so blocks can run in any order.
 */

const RUN = Date.now().toString(36);
const slug = (name: string) => `cov-${name}-${RUN}`;

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

async function shot(page: Page, name: string, fullPage = false) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

// ------------------------------------------------------------------ home

test.describe("home page", () => {
  const SAMPLE_CAPTION =
    /Sample testimonials for illustration\. Names and quotes are fictional; footage is licensed stock from Pexels, and the people shown haven't used or endorsed Plaudit\./;
  const VIDEO_FILE = /\.(webm|mp4)$/;

  /** Records every /samples/ file the page fetches, and any that fail. */
  function trackSamples(page: Page) {
    const loaded: string[] = [];
    const bad: string[] = [];
    page.on("response", (r) => {
      if (!r.url().includes("/samples/")) return;
      loaded.push(r.url().split("/samples/")[1]);
      if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
    });
    return { loaded, bad };
  }

  const SECTIONS = [
    "section-hero",
    "section-videos",
    "section-platforms",
    "section-voices",
    "section-how",
    "section-features",
    "section-showcase",
    "section-compare",
    "section-faq",
    "section-cta",
    "section-footer",
  ];

  test("every section renders and reveals as you scroll", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Let your customers say it for you." })).toBeVisible();
    await expect(page.getByTestId("home-nav")).toBeVisible();
    for (const id of SECTIONS) {
      const section = page.getByTestId(id);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
    }
    // Bring each reveal target into view in turn, as a reader would, and
    // wait for that one to fade in (robust to slow or headed runs).
    const reveals = page.locator("[data-reveal]");
    const count = await reveals.count();
    expect(count).toBeGreaterThan(10);
    for (let i = 0; i < count; i++) {
      const el = reveals.nth(i);
      await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await expect(el).toHaveClass(/(^|\s)is-in(\s|$)/, { timeout: 5000 });
    }
    await expect(page.getByTestId("platform-marquee")).toContainText("WordPress");
    await expect(page.getByTestId("platform-marquee")).toContainText("Plain HTML");
    await expect(page.getByTestId("sample-caption")).toHaveText(SAMPLE_CAPTION);
    await expect(page.locator(".voice-tag").first()).toHaveText("Sample");
    await expect(page.locator(".bento-tile")).toHaveCount(7);
    await expect(page.locator(".compare tbody tr")).toHaveCount(7);
  });

  test("nav shrinks and the progress bar fills on scroll", async ({ page }) => {
    await page.goto("/");
    const home = page.locator(".home");
    await expect(home).not.toHaveAttribute("data-scrolled", "");
    await page.mouse.wheel(0, 1600);
    await expect(home).toHaveAttribute("data-scrolled", "");
    await expect
      .poll(() => home.evaluate((el) => Number(getComputedStyle(el).getPropertyValue("--scroll-progress"))))
      .toBeGreaterThan(0);
  });

  test("hero demo advances on its own, pauses, resumes and jumps", async ({ page }) => {
    await page.goto("/");
    const demo = page.getByTestId("hero-demo");
    await expect(demo).toHaveAttribute("data-step", "record");
    await expect(page.getByTestId("demo-rec")).toHaveText(/REC 00:0[1-3]/, { timeout: 4000 });
    await expect(demo).toHaveAttribute("data-step", "review", { timeout: 6000 });
    await expect(demo.getByText("Approved", { exact: true })).toBeVisible();

    await demo.getByRole("button", { name: "Pause demo" }).click();
    await expect(demo).toHaveAttribute("data-paused", "true");
    await page.waitForTimeout(4500);
    await expect(demo).toHaveAttribute("data-step", "review");

    await demo.getByRole("button", { name: "Play demo" }).click();
    await expect(demo).toHaveAttribute("data-step", "live", { timeout: 6000 });
    await expect(demo.getByText("yoursite.com")).toBeVisible();

    await demo.getByRole("button", { name: "Recording" }).click();
    await expect(demo).toHaveAttribute("data-step", "record");
    await expect(demo.getByRole("button", { name: "Recording" })).toHaveAttribute("aria-current", "step");
  });

  test("the hero's Pending and Approved badges never show at the same time", async ({ page }) => {
    await page.goto("/");
    const demo = page.getByTestId("hero-demo");
    await demo.getByRole("button", { name: "Review" }).click();
    // Sample both badges every frame through the swap; the fainter of the two
    // is how much they overlap.
    const overlap = await page.evaluate(async () => {
      const pending = document.querySelector(".demo-badge-swap .pending")!;
      const approved = document.querySelector(".demo-badge-swap .approved")!;
      let worst = 0;
      const end = performance.now() + 2600;
      while (performance.now() < end) {
        await new Promise(requestAnimationFrame);
        const a = Number(getComputedStyle(pending).opacity);
        const b = Number(getComputedStyle(approved).opacity);
        worst = Math.max(worst, Math.min(a, b));
      }
      return worst;
    });
    expect(overlap).toBeLessThan(0.05);
    await expect(demo.locator(".demo-badge-swap .approved")).toHaveCSS("opacity", "1");
    await expect(demo.locator(".demo-badge-swap .pending")).toHaveCSS("opacity", "0");
  });

  test("the hero clip plays muted and looped, only while in view", async ({ page }) => {
    const { loaded, bad } = trackSamples(page);
    const demo = page.getByTestId("hero-demo");
    const clip = page.getByTestId("hero-clip");
    const video = clip.locator("video");
    const playing = () =>
      expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0), { timeout: 3000 });
    // The demo moves on every few seconds; going via Review restarts the Recording step's full time.
    const restartRecording = async () => {
      await demo.getByRole("button", { name: "Review" }).click();
      await demo.getByRole("button", { name: "Recording" }).click();
    };

    // Opened further down the page, the hero is out of view: nothing plays or downloads.
    await page.goto("/#faq");
    await page.waitForTimeout(1500);
    expect(loaded.filter((f) => VIDEO_FILE.test(f))).toEqual([]);

    await page.evaluate(() => window.scrollTo(0, 0));
    await restartRecording();
    await playing().toBe(true);
    await expect(clip).toHaveAttribute("data-playing", "true");
    expect(
      await video.evaluate((v: HTMLVideoElement) => [v.muted, v.loop, v.playsInline, v.autoplay, v.error]),
    ).toEqual([true, true, true, false, null]);
    // The poster is an image underneath, so something shows before the clip.
    await expect
      .poll(() => page.getByTestId("hero-poster").evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    // Only the hero clip has downloaded; every other video waits for a click.
    expect(new Set(loaded.filter((f) => VIDEO_FILE.test(f)))).toEqual(new Set(["daniel.webm"]));

    // Scrolled out of view, it pauses.
    await restartRecording();
    await playing().toBe(true);
    await page.getByTestId("section-faq").scrollIntoViewIfNeeded();
    await playing().toBe(false);

    // Pausing the demo pauses the clip too.
    await page.evaluate(() => window.scrollTo(0, 0));
    await restartRecording();
    await playing().toBe(true);
    await demo.getByRole("button", { name: "Pause demo" }).click();
    await playing().toBe(false);
    expect(bad).toEqual([]);
  });

  test("posters, faces and the hero clip cause no layout shift", async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.evaluate(() => {
        const w = window as Window & { __cls?: number };
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!e.hadRecentInput) w.__cls! += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      if (viewport.width > 900) {
        await expect(page.getByTestId("hero-clip")).toHaveAttribute("data-playing", "true", { timeout: 10_000 });
      } else {
        // On a phone the hero clip starts below the fold, so only its poster has loaded.
        await expect
          .poll(() => page.getByTestId("hero-poster").evaluate((img: HTMLImageElement) => img.naturalWidth))
          .toBeGreaterThan(0);
      }
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 400) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(60);
      }
      expect(await page.evaluate(() => (window as Window & { __cls?: number }).__cls)).toBe(0);
    }
  });

  test("every sample card shows a face that loads, and no sample file is missing", async ({ page }) => {
    const { bad } = trackSamples(page);
    await page.goto("/");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 400) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(40);
    }
    // Wall cards (video and text) and the first copy of each marquee row.
    const cards = page.locator("[data-sample-card]");
    await expect(cards).toHaveCount(3 + 4 + 7);
    for (const card of await cards.all()) {
      await expect(card.locator(".voice-tag")).toHaveText("Sample");
      const face = card.locator("img.face");
      await expect(face).toHaveCount(1);
      await face.evaluate((img: HTMLImageElement) => {
        img.loading = "eager"; // the marquee can hold a lazy image far off to the side
      });
      await expect
        .poll(() => face.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 10_000 })
        .toBeGreaterThan(0);
      await expect(face).toHaveAttribute("src", /^\/samples\/avatars\/\w+\.jpg$/);
    }
    // The widget showcase cards use the real card component with an avatar URL.
    const showcase = page.getByTestId("showcase-stage").locator("article.testimonial img.avatar");
    await expect(showcase).toHaveCount(4);
    for (const img of await showcase.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    }
    // Feature tiles and the how-it-works visual use faces too.
    for (const scope of [page.locator(".bento"), page.getByTestId("how-it-works")]) {
      const faces = scope.locator("img.face");
      expect(await faces.count()).toBeGreaterThan(0);
      for (const img of await faces.all()) {
        await img.evaluate((el: HTMLImageElement) => {
          el.loading = "eager";
        });
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      }
    }
    // The hero's review step shows the same person's face.
    const demo = page.getByTestId("hero-demo");
    await page.evaluate(() => window.scrollTo(0, 0));
    await demo.getByRole("button", { name: "Review" }).click();
    const reviewFace = demo.locator("img.demo-avatar");
    await expect(reviewFace).toHaveAttribute("src", "/samples/avatars/daniel.jpg");
    await expect.poll(() => reviewFace.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  test("sample video testimonials are labelled, lazy, muted, and play", async ({ page }) => {
    const { bad } = trackSamples(page);
    await page.goto("/");
    const section = page.getByTestId("section-videos");
    await section.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("video-sample-caption")).toHaveText(SAMPLE_CAPTION);
    await expect(page.getByTestId("video-sample-caption").getByRole("link", { name: "Credits" })).toHaveAttribute(
      "href",
      /docs\/CREDITS\.md$/,
    );
    const cards = section.locator(".video-card");
    await expect(cards).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(cards.nth(i).locator(".voice-tag")).toHaveText("Sample");
    }

    const players = section.getByTestId("sample-video");
    for (let i = 0; i < 3; i++) {
      const player = players.nth(i);
      const video = player.locator("video");
      await expect(video).toHaveAttribute("poster", /\/samples\/\w+\.jpg$/);
      // Never autoplays and fetches no video data until the visitor asks.
      expect(
        await video.evaluate((v: HTMLVideoElement) => [v.paused, v.preload, v.muted, v.autoplay, v.readyState]),
      ).toEqual([true, "none", true, false, 0]);
      await player.getByRole("button", { name: /^Play sample video testimonial/ }).click();
      await expect(player).toHaveAttribute("data-started", "true");
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 })
        .toBeGreaterThan(0);
      expect(await video.evaluate((v: HTMLVideoElement) => [v.muted, v.error, v.controls])).toEqual([true, null, true]);
      await video.evaluate((v: HTMLVideoElement) => v.pause());
    }
    expect(bad).toEqual([]);
  });

  test("hero demo and widget showcase include a video card", async ({ page }) => {
    await page.goto("/");
    const demo = page.getByTestId("hero-demo");
    await demo.getByRole("button", { name: "Live on your site" }).click();
    const thumb = demo.getByTestId("demo-video-thumb").locator("img");
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(demo.locator(".demo-sample")).toHaveText("Sample");

    const stage = page.getByTestId("showcase-stage");
    await stage.scrollIntoViewIfNeeded();
    const video = stage.locator("article.testimonial video");
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute("poster", /\/samples\/aiko\.jpg$/);
    expect(await video.evaluate((v: HTMLVideoElement) => [v.paused, v.preload, v.muted])).toEqual([true, "none", true]);
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(stage.getByText("Sample: Grace")).toBeVisible();
  });

  test("sample media files are served with the right types and ranges", async ({ request }) => {
    for (const id of ["maya", "daniel", "aiko"]) {
      const webm = await request.get(`/samples/${id}.webm`);
      expect(webm.status()).toBe(200);
      expect(webm.headers()["content-type"]).toContain("video/webm");
      const size = (await webm.body()).length;
      expect(size).toBeLessThan(3 * 1024 * 1024);
      const mp4 = await request.get(`/samples/${id}.mp4`);
      expect(mp4.status()).toBe(200);
      expect(mp4.headers()["content-type"]).toContain("video/mp4");
      expect((await request.get(`/samples/${id}.jpg`)).headers()["content-type"]).toContain("image/jpeg");
      const part = await request.get(`/samples/${id}.webm`, { headers: { Range: "bytes=0-1023" } });
      expect(part.status()).toBe(206);
    }
  });

  test("sticky how-it-works follows the step in view", async ({ page }) => {
    await page.goto("/");
    const how = page.getByTestId("how-it-works");
    for (const step of ["ask", "approve", "show"]) {
      await how.locator(`li[data-step="${step}"]`).evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(how).toHaveAttribute("data-active", step);
    }
  });

  test("marquees pause on hover and focus", async ({ page }) => {
    await page.goto("/");
    const row = page.getByTestId("voices-marquee").first();
    await row.scrollIntoViewIfNeeded();
    const state = () => row.locator(".marquee-track").evaluate((el) => getComputedStyle(el).animationPlayState);
    expect(await state()).toBe("running");
    await row.hover();
    expect(await state()).toBe("paused");
    await page.mouse.move(0, 0);
    expect(await state()).toBe("running");
    await row.focus();
    expect(await state()).toBe("paused");
  });

  test("widget showcase switches theme and layout", async ({ page }) => {
    await page.goto("/");
    const showcase = page.getByTestId("widget-showcase");
    await showcase.scrollIntoViewIfNeeded();
    const stage = page.getByTestId("showcase-stage");
    await expect(stage.locator("article.testimonial")).toHaveCount(4);
    const cardBg = () => stage.locator("article.testimonial").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await cardBg()).toBe("rgb(255, 255, 255)");
    await showcase.getByRole("button", { name: "Dark" }).click();
    await expect(stage).toHaveAttribute("data-theme", "dark");
    expect(await cardBg()).toBe("rgb(23, 27, 43)");
    await showcase.getByRole("button", { name: "List" }).click();
    await expect(stage).toHaveAttribute("data-layout", "list");
    await expect(stage.locator(".showcase-list")).toBeVisible();
  });

  test("FAQ opens and closes", async ({ page }) => {
    await page.goto("/");
    const item = page.locator(".faq details").first();
    await item.scrollIntoViewIfNeeded();
    await expect(item).not.toHaveAttribute("open", "");
    await item.locator("summary").click();
    await expect(item).toHaveAttribute("open", "");
    await expect(item.locator(".faq-body")).toBeVisible();
    await item.locator("summary").click();
    await expect(item).not.toHaveAttribute("open", "");
    // Keyboard works too.
    await item.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(item).toHaveAttribute("open", "");
  });

  test("no horizontal overflow at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    for (const id of SECTIONS) await page.getByTestId(id).scrollIntoViewIfNeeded();
    const widths = await page.evaluate(() => {
      window.scrollTo(600, window.scrollY);
      return { scrollX: window.scrollX, scrollWidth: document.documentElement.scrollWidth, inner: window.innerWidth };
    });
    expect(widths.scrollX).toBe(0);
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.inner);
    await expect(page.getByRole("link", { name: "Open dashboard" }).first()).toBeVisible();
  });

  test("reduced motion shows everything and stops movement", async ({ page }) => {
    const { loaded } = trackSamples(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    // The hero shows the poster instead of looping the clip, and no video downloads.
    const clip = page.getByTestId("hero-clip");
    await expect(clip.locator("video")).toHaveCount(0);
    await expect
      .poll(() => page.getByTestId("hero-poster").evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    expect(loaded.filter((f) => VIDEO_FILE.test(f))).toEqual([]);
    await expect(page.locator(".home")).not.toHaveClass(/motion-ready/);
    // Without scrolling, every reveal target is already fully visible.
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-reveal]")].filter(
        (el) => getComputedStyle(el).opacity !== "1" || getComputedStyle(el).transform !== "none",
      ).length,
    );
    expect(hidden).toBe(0);
    expect(
      await page.locator(".marquee-track").first().evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    expect(await page.locator(".word").first().evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    const demo = page.getByTestId("hero-demo");
    await expect(demo).toHaveAttribute("data-paused", "true");
    await page.waitForTimeout(4200);
    await expect(demo).toHaveAttribute("data-step", "record");
    // Steps are still reachable by hand.
    await demo.getByRole("button", { name: "Live on your site" }).click();
    await expect(demo).toHaveAttribute("data-step", "live");
  });

  test("keyboard focus stays visible", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return getComputedStyle(el).outlineStyle;
    });
    expect(outline).not.toBe("none");
  });

  test("screenshots", async ({ page }) => {
    test.skip(!SHOTS, "only when UPDATE_SCREENSHOTS is set");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForTimeout(1200);
    await shot(page, "home-desktop");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 300) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await shot(page, "home-full", true);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForTimeout(1200);
    await shot(page, "home-mobile");
  });
});

// ------------------------------------------------------------------ auth

test.describe("auth", () => {
  test("wrong password shows an error", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(E2E_ADMIN.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /wrong email or password/i })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("signed-out visitors are sent to the login page", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const project = await createProject(api, "Auth Guard", slug("guard"));
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto(`/admin/projects/${project.id}`);
    await expect(page).toHaveURL(/\/admin\/login$/);
    const res = await page.request.get(`/api/admin/projects/${project.id}`);
    expect(res.status()).toBe(401);
  });

  test("sign out returns to the login page and ends the session", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

// ------------------------------------------------------- admin on a phone

test.describe("admin at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  /** Nothing overflows sideways, and the app bar's trail never runs into its actions. */
  async function fitsThePhone(page: Page) {
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    const crumbs = (await page.locator(".app-bar .crumbs").boundingBox())!;
    const actions = (await page.locator(".app-bar-actions").boundingBox())!;
    expect(crumbs.x + crumbs.width).toBeLessThanOrEqual(actions.x);
    for (const name of ["Settings", "Sign out"]) {
      const box = (await page.getByRole(name === "Settings" ? "link" : "button", { name, exact: true }).first().boundingBox())!;
      expect(box.x + box.width, name).toBeLessThanOrEqual(375);
    }
  }

  test("every admin page fits, and every control can be reached", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const project = await createProject(api, "A Rather Long Project Name For A Phone", slug("phone"));
    await seed(api, project.slug, [{ name: "Polly Phone", text: "Small screens too.", status: "approved" }]);
    // Settings' tables only appear once there's something in them.
    expect((await api.post("/api/admin/api-keys", { data: { name: "A phone-width key", scope: "read" } })).status()).toBe(201);
    await signIn(page);
    await fitsThePhone(page);

    await page.goto(`/admin/projects/${project.id}`);
    await fitsThePhone(page);
    // The current page is named in the trail; the full trail returns on wider screens.
    await expect(page.locator(".app-bar .crumb.current")).toBeVisible();
    // Every status filter, "All" included, is on screen and works.
    const filter = page.getByRole("group", { name: "Filter by status" });
    for (const label of ["Pending", "Approved", "Rejected", "All"]) {
      const button = filter.getByRole("button", { name: new RegExp(`^${label}`) });
      const box = (await button.boundingBox())!;
      expect(box.x, label).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, label).toBeLessThanOrEqual(375);
    }
    await filter.getByRole("button", { name: /^All/ }).click();
    await expect(filter.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Polly Phone")).toBeVisible();

    // Every project tab is fully on screen and opens its page.
    const tabs = page.getByRole("navigation", { name: "Project sections" });
    for (const name of ["Testimonials", "Requests", "Import & export"]) {
      const box = (await tabs.getByRole("link", { name }).boundingBox())!;
      expect(box.x + box.width, name).toBeLessThanOrEqual(375);
    }
    await tabs.getByRole("link", { name: "Import & export" }).click();
    await expect(page.getByRole("heading", { name: "Import & export", level: 1 })).toBeVisible();
    await fitsThePhone(page);
    await tabs.getByRole("link", { name: "Requests" }).click();
    await expect(page).toHaveURL(/\/requests$/);
    await fitsThePhone(page);

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await fitsThePhone(page);
  });
});

// -------------------------------------------------------------- projects

test.describe("projects", () => {
  test("create a project, reject invalid and duplicate slugs", async ({ page }) => {
    await signIn(page);
    const s = slug("create");

    // Invalid slug: the browser blocks it, and the API refuses it too.
    await page.getByLabel("Name").fill("Bad Slug Co");
    await page.getByLabel(/^Link slug/).fill("Bad Slug!");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect(await page.getByLabel(/^Link slug/).evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    const origin = new URL(page.url()).origin;
    const apiRes = await page.request.post("/api/admin/projects", {
      data: { name: "X", slug: "Bad Slug!" },
      headers: { origin },
    });
    expect(apiRes.status()).toBe(400);
    // The session cookie alone isn't enough: a change must come with this site's Origin.
    const noOrigin = await page.request.post("/api/admin/projects", { data: { name: "X", slug: "no-origin-x" } });
    expect(noOrigin.status()).toBe(403);

    // Valid.
    await page.getByLabel("Name").fill("Coverage Co");
    await page.getByLabel(/^Link slug/).fill(s);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Coverage Co" })).toBeVisible();

    // Duplicate.
    await page.goto("/admin");
    await expect(page.getByText(`/${s}`)).toBeVisible();
    await page.getByLabel("Name").fill("Coverage Co again");
    await page.getByLabel(/^Link slug/).fill(s);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.locator("p.error")).toHaveText(/already taken/i);
  });
});

// -------------------------------------------------------------- settings

test.describe("settings", () => {
  let projectId = "";
  const s = slug("settings");

  test.beforeAll(async ({ baseURL }) => {
    projectId = (await createProject(await adminApi(baseURL!), "Settings Co", s)).id;
  });

  async function saveSettings(page: Page, fill: (form: ReturnType<Page["locator"]>) => Promise<void>) {
    await page.goto(`/admin/projects/${projectId}`);
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save settings" }) });
    await fill(form);
    await form.getByRole("button", { name: "Save settings" }).click();
    await expect(form.getByRole("status")).toHaveText("Settings saved");
  }

  test("name, question, thank-you and brand colour reach the collection page", async ({ page }) => {
    await signIn(page);
    await saveSettings(page, async (form) => {
      await form.getByLabel("Project name").fill("Sunny Studio");
      await form.getByLabel("Question shown to customers").fill("What did Sunny Studio do for you?");
      await form.getByLabel("Thank-you message").fill("Thanks a million, friend!");
      await form.getByLabel("Brand colour").fill("#ffd60a");
    });

    await page.goto(`/c/${s}`);
    await expect(page.locator(".org")).toHaveText(/Sunny Studio/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What did Sunny Studio do for you?");
    const submit = page.getByRole("button", { name: "Submit testimonial" });
    // Light brand colour: the button text flips to dark ink for contrast.
    expect(await submit.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 214, 10)");
    expect(await submit.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(22, 27, 46)");

    await page.getByLabel("Your testimonial").fill("Bright and lovely.");
    await page.getByLabel("Your name").fill("Settings Tester");
    await page.getByLabel(/I agree/).check();
    await submit.click();
    await expect(page.getByRole("status")).toContainText("Thanks a million, friend!");

    // Dark brand colour: white text.
    await saveSettings(page, async (form) => {
      await form.getByLabel("Brand colour").fill("#1d3a8a");
    });
    await page.goto(`/c/${s}`);
    const submit2 = page.getByRole("button", { name: "Submit testimonial" });
    expect(await submit2.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
  });

  test("turning off text or video hides that mode", async ({ page }) => {
    await signIn(page);

    await saveSettings(page, async (form) => {
      await form.getByLabel("Allow written testimonials").uncheck();
      await form.getByLabel("Allow video testimonials").check();
    });
    await page.goto(`/c/${s}`);
    await expect(page.getByRole("group", { name: "Testimonial type" })).toHaveCount(0);
    await expect(page.getByLabel("Your testimonial")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Record with camera/ })).toBeVisible();

    await saveSettings(page, async (form) => {
      await form.getByLabel("Allow written testimonials").check();
      await form.getByLabel("Allow video testimonials").uncheck();
    });
    await page.goto(`/c/${s}`);
    await expect(page.getByRole("group", { name: "Testimonial type" })).toHaveCount(0);
    await expect(page.getByLabel("Your testimonial")).toBeVisible();
    await expect(page.getByRole("button", { name: /Record with camera/ })).toHaveCount(0);

    await saveSettings(page, async (form) => {
      await form.getByLabel("Allow video testimonials").check();
    });
    await page.goto(`/c/${s}`);
    await expect(page.getByRole("group", { name: "Testimonial type" })).toBeVisible();
  });
});

// ------------------------------------------------------- collection form

test.describe("collection form", () => {
  const s = slug("form");
  let api: APIRequestContext;
  let projectId = "";

  test.beforeAll(async ({ baseURL }) => {
    api = await adminApi(baseURL!);
    projectId = (await createProject(api, "Form Co", s)).id;
  });

  async function fillBasics(page: Page, name: string) {
    await page.goto(`/c/${s}`);
    await page.getByLabel("Your testimonial").fill(`Words from ${name}`);
    await page.getByLabel("Your name").fill(name);
  }

  async function names() {
    const res = await api.get(`/api/admin/projects/${projectId}`);
    return ((await res.json()).testimonials as { authorName: string }[]).map((t) => t.authorName);
  }

  test("rating is optional", async ({ page }) => {
    await fillBasics(page, "No Rating");
    await page.getByLabel(/I agree/).check();
    await page.getByRole("button", { name: "Submit testimonial" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    expect(await names()).toContain("No Rating");
  });

  test("consent is required", async ({ page }) => {
    await fillBasics(page, "No Consent");
    await page.getByRole("button", { name: "Submit testimonial" }).click();
    expect(await page.getByLabel(/I agree/).evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(await names()).not.toContain("No Consent");
  });

  test("video mode needs a video", async ({ page }) => {
    await page.goto(`/c/${s}`);
    await page.getByRole("button", { name: "Video" }).click();
    await page.getByLabel("Your name").fill("No Video");
    await page.getByLabel(/I agree/).check();
    await page.getByRole("button", { name: "Submit testimonial" }).click();
    await expect(page.locator("p.error")).toHaveText("Record or upload a video before sending.");
  });

  test("avatar of the wrong type is refused as soon as it's picked", async ({ page }) => {
    await fillBasics(page, "Bad Avatar");
    await page.locator('input[name="avatar"]').setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
    });
    await expect(page.getByTestId("photo-problem")).toHaveText("This photo isn't a format we can use. Choose a PNG, JPEG, WebP or GIF image.");
    await expect(page.getByText("Looks good. Click to change it.")).toHaveCount(0);
    expect(await page.locator('input[name="avatar"]').evaluate((i: HTMLInputElement) => i.files?.length)).toBe(0);
    // A good one clears the message.
    await page.locator('input[name="avatar"]').setInputFiles(path.join(FIXTURES, "avatar.png"));
    await expect(page.getByText("Looks good. Click to change it.")).toBeVisible();
    await expect(page.getByTestId("photo-problem")).toHaveCount(0);
  });

  test("oversized avatar is refused as soon as it's picked", async ({ page }) => {
    await fillBasics(page, "Huge Avatar");
    const png = fs.readFileSync(path.join(FIXTURES, "avatar.png"));
    await page.locator('input[name="avatar"]').setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.concat([png, Buffer.alloc(5.5 * 1024 * 1024)]),
    });
    await expect(page.getByTestId("photo-problem")).toHaveText("The file is larger than 5 MB");
    expect(await page.locator('input[name="avatar"]').evaluate((i: HTMLInputElement) => i.files?.length)).toBe(0);
  });

  test("a valid avatar is stored", async ({ page }) => {
    await fillBasics(page, "Good Avatar");
    await page.locator('input[name="avatar"]').setInputFiles(path.join(FIXTURES, "avatar.png"));
    await page.getByLabel(/I agree/).check();
    await page.getByRole("button", { name: "Submit testimonial" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    const res = await api.get(`/api/admin/projects/${projectId}`);
    const t = ((await res.json()).testimonials as { authorName: string; avatarKey: string | null }[]).find(
      (x) => x.authorName === "Good Avatar",
    );
    expect(t?.avatarKey).toMatch(/^images\/.+\.png$/);
  });

  test("honeypot submissions are silently dropped", async ({ page }) => {
    await fillBasics(page, "Bot McBotface");
    await page.locator('input[name="website"]').evaluate((el: HTMLInputElement) => {
      el.value = "http://spam.example";
    });
    await page.getByLabel(/I agree/).check();
    await page.getByRole("button", { name: "Submit testimonial" }).click();
    // Looks like a success to the bot...
    await expect(page.getByRole("status")).toBeVisible();
    // ...but nothing was stored.
    expect(await names()).not.toContain("Bot McBotface");
  });
});

// ------------------------------------------------------------ moderation

test.describe("moderation", () => {
  const s = slug("mod");
  let projectId = "";

  test.beforeAll(async ({ baseURL }) => {
    const api = await adminApi(baseURL!);
    projectId = (await createProject(api, "Moderation Co", s)).id;
    await seed(api, s, [
      { name: "Alpha", text: "First" },
      { name: "Bravo", text: "Second" },
      { name: "Charlie", text: "Third" },
      { name: "Delta", text: "Fourth" },
    ]);
  });

  test("approve, reject, move back, rename, tag and delete, with live counts", async ({ page }) => {
    await signIn(page);
    await page.goto(`/admin/projects/${projectId}`);
    const filters = page.getByRole("group", { name: "Filter by status" });
    const tab = (label: string) => filters.getByRole("button", { name: new RegExp(`^${label}`) });
    const count = (label: string) => tab(label).locator(".count");
    const card = (name: string) => page.getByTestId("admin-testimonial").filter({ hasText: name });

    await expect(count("Pending")).toHaveText("4");
    await expect(count("All")).toHaveText("4");

    await card("Alpha").getByRole("button", { name: "Approve" }).click();
    await expect(count("Pending")).toHaveText("3");
    await expect(count("Approved")).toHaveText("1");

    await card("Bravo").getByRole("button", { name: "Reject" }).click();
    await expect(count("Pending")).toHaveText("2");
    await expect(count("Rejected")).toHaveText("1");

    // Move the rejected one back to pending.
    await tab("Rejected").click();
    await card("Bravo").getByRole("button", { name: "Move to pending" }).click();
    await expect(count("Rejected")).toHaveText("0");
    await expect(count("Pending")).toHaveText("3");

    // Rename and tag.
    await tab("Pending").click();
    await card("Charlie").getByLabel("Display name").fill("Charlie C.");
    await card("Charlie").getByLabel(/^Tags/).fill("Homepage, pricing");
    await card("Charlie").getByRole("button", { name: "Save" }).click();
    await expect(card("Charlie C.").getByLabel(/^Tags/)).toHaveValue("homepage, pricing");

    // Delete (accept the confirm dialog).
    page.once("dialog", (d) => d.accept());
    await card("Delta").getByRole("button", { name: "Delete" }).click();
    await expect(card("Delta")).toHaveCount(0);
    await expect(count("All")).toHaveText("3");
    await expect(count("Pending")).toHaveText("2");

    // Dismissing the dialog keeps it.
    page.once("dialog", (d) => d.dismiss());
    await card("Bravo").getByRole("button", { name: "Delete" }).click();
    await expect(card("Bravo")).toHaveCount(1);

    // Stat tiles agree.
    await expect(page.locator(".stat.pending strong")).toHaveText("2");
  });
});

// ------------------------------------------------------- wall + widgets

test.describe("public surfaces", () => {
  const s = slug("pub");
  const empty = slug("empty");
  let host: Awaited<ReturnType<typeof startHostServer>>;
  let appOrigin = "";

  test.beforeAll(async ({ baseURL }) => {
    appOrigin = new URL(baseURL!).origin;
    const api = await adminApi(baseURL!);
    await createProject(api, "Public Co", s);
    await createProject(api, "Empty Co", empty);
    await seed(api, s, [
      { name: "Homer", text: "Home page hero", email: "homer@private.example", rating: 5, status: "approved", tags: ["home"] },
      { name: "Priya", text: "Pricing page love", email: "priya@private.example", rating: 4, status: "approved", tags: ["pricing"] },
      { name: "Vidya", email: "vidya@private.example", video: true, status: "approved", tags: ["home"] },
      { name: "Pending Pete", text: "Not yet", email: "pete@private.example" },
      { name: "Rejected Rita", text: "Nope", email: "rita@private.example", status: "rejected" },
    ]);
    host = await startHostServer();
  });

  test.afterAll(async () => host?.close());

  // Extra request headers would turn the widget's cross-origin fetch into a
  // CORS preflight (as they would for any real host page), so drop them here.
  test.beforeEach(async ({ page }) => {
    await page.setExtraHTTPHeaders({});
  });

  test("wall shows only approved items, never emails, with tag and theme options", async ({ page }) => {
    await page.goto(`/wall/${s}`);
    const cards = page.locator("article.testimonial");
    await expect(cards).toHaveCount(3);
    for (const hidden of ["Pending Pete", "Rejected Rita"]) await expect(page.getByText(hidden)).toHaveCount(0);
    expect(await page.content()).not.toContain("@private.example");

    await page.goto(`/wall/${s}?tag=home`);
    await expect(cards).toHaveCount(2);
    await expect(page.getByText("Priya")).toHaveCount(0);

    await page.goto(`/wall/${s}?theme=dark`);
    await expect(page.locator('[data-theme="dark"]').first()).toBeVisible();
    expect(await cards.first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 27, 43)");

    await page.goto(`/wall/${s}?tag=nothing-here`);
    await expect(page.getByText("No testimonials here yet.")).toBeVisible();
    await page.goto(`/wall/${empty}`);
    await expect(page.getByText("No testimonials here yet.")).toBeVisible();
  });

  async function widget(page: Page, name: string, attrs: string) {
    host.pages[`/${name}.html`] = hostPage(name, `<script src="${appOrigin}/widget.js" ${attrs} async></script>`);
    await page.goto(`${host.url}/${name}.html`);
    return page.locator("[data-plaudit-widget]");
  }

  test("script widget: tag, limit and list layout", async ({ page }) => {
    let w = await widget(page, "tag", `data-project="${s}" data-tag="home"`);
    await expect(w).toHaveAttribute("data-plaudit-ready", "2");
    await expect(w.locator("article.c")).toHaveCount(2);

    w = await widget(page, "limit", `data-project="${s}" data-limit="1"`);
    await expect(w).toHaveAttribute("data-plaudit-ready", "1");

    w = await widget(page, "list", `data-project="${s}" data-layout="list"`);
    await expect(w).toHaveAttribute("data-plaudit-ready", "3");
    await expect(w.locator(".list")).toBeVisible();
    await expect(w.locator(".grid")).toHaveCount(0);
  });

  test("script widget: auto theme follows the visitor's colour scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    let w = await widget(page, "auto-dark", `data-project="${s}" data-theme="auto"`);
    await expect(w).toHaveAttribute("data-plaudit-ready", "3");
    expect(await w.locator("article.c").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(23, 27, 43)",
    );
    await page.emulateMedia({ colorScheme: "light" });
    w = await widget(page, "auto-light", `data-project="${s}" data-theme="auto"`);
    await expect(w).toHaveAttribute("data-plaudit-ready", "3");
    expect(await w.locator("article.c").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(255, 255, 255)",
    );
  });

  test("script widget is isolated from hostile host CSS and never shows emails", async ({ page }) => {
    const w = await widget(page, "hostile", `data-project="${s}" data-theme="light"`);
    await expect(w).toHaveAttribute("data-plaudit-ready", "3");
    const name = w.getByText("Homer", { exact: true });
    const styles = await name.evaluate((el) => {
      const c = getComputedStyle(el);
      return { color: c.color, font: c.fontFamily, spacing: c.letterSpacing };
    });
    expect(styles.color).not.toBe("rgb(255, 0, 0)");
    expect(styles.font).not.toContain("Comic Sans");
    const card = w.locator("article.c").first();
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    const shadowText = await w.evaluate((el) => el.shadowRoot?.innerHTML ?? "");
    expect(shadowText).not.toContain("@private.example");
    await expect(w.getByText("Pending Pete")).toHaveCount(0);
  });

  test("script widget shows an empty state", async ({ page }) => {
    const w = await widget(page, "empty", `data-project="${empty}"`);
    await expect(w.getByText("No testimonials yet.")).toBeVisible();
  });

  test("iframe embed auto-resizes and follows its theme", async ({ page, baseURL }) => {
    for (const theme of ["light", "dark"] as const) {
      const id = `plaudit-${s}`;
      host.pages[`/iframe-${theme}.html`] = hostPage(
        `iframe ${theme}`,
        `<iframe src="${baseURL}/embed/${s}?theme=${theme}" title="Testimonials" style="width:100%;border:0;height:400px" id="${id}"></iframe>
<script>addEventListener("message",function(e){if(e.data&&e.data.type==="plaudit:resize"&&e.data.slug==="${s}"){document.getElementById("${id}").style.height=e.data.height+"px"}})</script>`,
      );
      await page.goto(`${host.url}/iframe-${theme}.html`);
      const frame = page.frameLocator(`#${id}`);
      await expect(frame.locator("article.testimonial")).toHaveCount(3);
      await expect(frame.locator("#plaudit-embed")).toHaveAttribute("data-theme", theme);
      const contentHeight = await frame
        .locator("#plaudit-embed")
        .evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
      await expect
        .poll(() => page.locator(`#${id}`).evaluate((el) => (el as HTMLElement).style.height))
        .toBe(`${contentHeight}px`);
      const bg = await frame.locator("article.testimonial").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(theme === "dark" ? "rgb(23, 27, 43)" : "rgb(255, 255, 255)");
    }
  });

  test("API: widget feed is public-safe; unknown slugs 404; media supports ranges", async ({ request }) => {
    const res = await request.get(`/api/widget/${s}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["access-control-allow-origin"]).toBe("*");
    const raw = await res.text();
    expect(raw).not.toContain("@private.example");
    expect(raw.toLowerCase()).not.toContain("email");
    const body = JSON.parse(raw);
    expect(body.testimonials).toHaveLength(3);
    for (const t of body.testimonials) {
      expect(Object.keys(t).sort()).toEqual(
        ["avatarUrl", "company", "createdAt", "id", "name", "rating", "tags", "text", "title", "video"].sort(),
      );
    }

    expect((await request.get(`/api/widget/no-such-project-${RUN}`)).status()).toBe(404);

    const video = body.testimonials.find((t: { video: unknown }) => t.video).video as { url: string; mime: string };
    // WebM until the background worker has converted it to MP4.
    expect(["video/webm", "video/mp4"]).toContain(video.mime);
    const full = await request.get(video.url);
    expect(full.status()).toBe(200);
    const size = Number(full.headers()["content-length"]);
    const part = await request.get(video.url, { headers: { Range: "bytes=0-99" } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-range"]).toBe(`bytes 0-99/${size}`);
    expect((await part.body()).length).toBe(100);
    const bad = await request.get(video.url, { headers: { Range: `bytes=${size + 10}-` } });
    expect(bad.status()).toBe(416);
    expect((await request.get("/api/media/videos/00000000-0000-0000-0000-000000000000.webm")).status()).toBe(404);
  });
});

// ---------------------------------------------------------- copy buttons

test.describe("share & embed", () => {
  const s = slug("copy");
  let projectId = "";

  test.beforeAll(async ({ baseURL }) => {
    projectId = (await createProject(await adminApi(baseURL!), "Copy Co", s)).id;
  });

  test("copy buttons copy the exact snippet", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
    await signIn(page);
    await page.goto(`/admin/projects/${projectId}`);
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

    await page.getByRole("button", { name: "Copy link" }).click();
    expect(await clipboard()).toMatch(new RegExp(`/c/${s}$`));

    await page.getByRole("group", { name: "Widget theme" }).getByRole("button", { name: "Dark" }).click();
    const scriptSnippet = page.getByTestId("script-snippet");
    await scriptSnippet.locator("..").getByRole("button", { name: "Copy" }).click();
    const copiedScript = await clipboard();
    expect(copiedScript).toBe(await scriptSnippet.innerText());
    expect(copiedScript).toContain(`data-project="${s}"`);
    expect(copiedScript).toContain('data-theme="dark"');
    await expect(scriptSnippet.locator("..").getByRole("button", { name: "Copied" })).toBeVisible();

    const iframeSnippet = page.getByTestId("iframe-snippet");
    await iframeSnippet.locator("..").getByRole("button", { name: "Copy" }).click();
    const copiedIframe = await clipboard();
    expect(copiedIframe).toBe(await iframeSnippet.innerText());
    expect(copiedIframe).toContain(`/embed/${s}?theme=dark`);
  });
});
