import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";
import {
  adminApi,
  allowClipboard,
  createProject,
  FIXTURES,
  hostPage,
  seed,
  SHOTS,
  skipLinuxWebkitMedia,
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
  const HEADLINE = "Turn happy customers into your best page.";

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
    "section-platforms",
    "section-how",
    "section-studio",
    "section-features",
    "section-selfhost",
    "section-compare",
    "section-faq",
    "section-cta",
    "section-footer",
  ];

  /** The brand colour the page resolved, e.g. "#5b3df5". */
  const primary = (page: Page) =>
    page.getByTestId("home").evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim().toLowerCase());

  test("every section renders, the wall rises in once and the vignettes play in view", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    await expect(page.getByTestId("home-nav")).toBeVisible();
    await expect(page.getByTestId("home")).toHaveClass(/(^|\s)motion-ok(\s|$)/);

    // The headline tile comes first, then the testimonials; each tile ends fully shown.
    const tiles = page.locator(".wall-tile");
    await expect(tiles.first()).toHaveAttribute("data-testid", "hero-tile");
    await expect
      .poll(() =>
        tiles.evaluateAll((els) =>
          els.every((el) => getComputedStyle(el).opacity === "1" && el.getAnimations().every((a) => a.playState === "finished")),
        ),
      )
      .toBe(true);
    // Staggered: later tiles start later.
    const delays = await tiles.evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).animationDelay)));
    expect(delays[0]).toBe(0);
    expect(delays[3]).toBeGreaterThan(delays[1]);

    for (const id of SECTIONS) {
      const section = page.getByTestId(id);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
    }
    // Each how-it-works vignette is marked when it comes into view, as a reader scrolls.
    const reveals = page.locator("[data-reveal]");
    await expect(reveals).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const el = reveals.nth(i);
      await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await expect(el).toHaveClass(/(^|\s)is-in(\s|$)/, { timeout: 5000 });
      await expect(el).toHaveAttribute("data-inview", "");
    }
    // The queue vignette ends with Ken approved.
    await expect.poll(() => page.locator(".vg-badge-to").evaluate((el) => getComputedStyle(el).opacity), { timeout: 5000 }).toBe("1");

    await expect(page.getByTestId("platform-marquee")).toContainText("WordPress");
    await expect(page.getByTestId("platform-marquee")).toContainText("Plain HTML");
    await expect(page.getByTestId("sample-caption")).toHaveText(SAMPLE_CAPTION);
    await expect(page.getByTestId("sample-caption").getByRole("link", { name: "Credits" })).toHaveAttribute("href", /docs\/CREDITS\.md$/);
    await expect(page.getByTestId("feature-tile")).toHaveCount(6);
    await expect(page.getByTestId("compare-table").locator("tbody tr")).toHaveCount(7);
    await expect(page.getByTestId("faq").getByRole("button")).toHaveCount(6);
  });

  test("the header is clear at the top and gains a blurred surface once you scroll", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByTestId("home-nav");
    await expect(nav).not.toHaveAttribute("data-scrolled", "");
    expect(await nav.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    await page.mouse.wheel(0, 900);
    await expect(nav).toHaveAttribute("data-scrolled", "");
    await expect.poll(() => nav.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur");
    // Still on screen, stuck to the top.
    expect(await nav.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(nav).not.toHaveAttribute("data-scrolled", "");
  });

  test("on a phone the menu is a sheet: focus stays inside and Esc closes it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    const trigger = page.getByTestId("menu-button");
    await trigger.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "How it works" })).toBeVisible();
    // Tab around more times than there are controls: focus never leaves the sheet.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    // A link closes it and goes to its section.
    await trigger.click();
    await page.getByRole("dialog").getByRole("link", { name: "FAQ" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).toHaveURL(/#faq$/);
  });

  test("video tiles show posters, load nothing until asked, preview on hover and play on click", async ({ page, browserName }) => {
    skipLinuxWebkitMedia(browserName);
    const { loaded, bad } = trackSamples(page);
    await page.goto("/");
    const tiles = page.getByTestId("video-tile");
    await expect(tiles).toHaveCount(3);
    for (const tile of await tiles.all()) {
      await expect(tile.getByText("Sample", { exact: true })).toBeVisible();
      const poster = tile.getByTestId("video-poster");
      await expect(poster).toHaveAttribute("src", /\/samples\/\w+\.jpg$/);
      await expect(poster).toHaveAttribute("width", "960");
      await expect(poster).toHaveAttribute("height", "600");
      // The player is there, but with no source yet: nothing to download.
      expect(await tile.locator("video").evaluate((v: HTMLVideoElement) => [v.getAttribute("src"), v.preload, v.autoplay])).toEqual([
        null,
        "none",
        false,
      ]);
    }
    await page.waitForTimeout(800);
    expect(loaded.filter((f) => VIDEO_FILE.test(f))).toEqual([]);

    // Hover (a mouse is a precise pointer): a muted, looping preview.
    const first = tiles.first();
    await first.hover();
    const video = first.locator("video");
    await expect(video).toHaveAttribute("src", /\/samples\/maya\.(webm|mp4)$/);
    await expect(first).toHaveAttribute("data-state", "preview", { timeout: 15_000 });
    expect(await video.evaluate((v: HTMLVideoElement) => [v.muted, v.loop])).toEqual([true, true]);
    await page.mouse.move(0, 0);
    await expect(first).toHaveAttribute("data-state", "idle");
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

    // Click: plays inline, unmuted, then the same button pauses.
    const second = tiles.nth(1);
    await second.scrollIntoViewIfNeeded();
    await second.getByRole("button", { name: /^Play Daniel's sample video testimonial$/ }).click();
    await expect(second).toHaveAttribute("data-state", "playing");
    const v2 = second.locator("video");
    await expect.poll(() => v2.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await v2.evaluate((v: HTMLVideoElement) => [v.loop, v.error, v.playsInline])).toEqual([false, null, true]);
    await expect(second.getByText("No sound in this sample")).toBeVisible();
    await second.getByRole("button", { name: /^Pause Daniel's/ }).click();
    await expect(second).toHaveAttribute("data-state", "paused");
    expect(await v2.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    // Keyboard works too.
    await second.getByRole("button", { name: /^Play Daniel's/ }).focus();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("data-state", "playing");
    expect(bad).toEqual([]);
  });

  test("text tiles: drawn stars with a label, a Sample tag and the person's face", async ({ page }) => {
    const { bad } = trackSamples(page);
    await page.goto("/");
    const cards = page.getByTestId("text-tile");
    await expect(cards).toHaveCount(5);
    for (const card of await cards.all()) {
      await expect(card.getByText("Sample", { exact: true })).toBeVisible();
      await expect(card.getByRole("img", { name: /^Rated [1-5] out of 5$/ })).toBeVisible();
      await expect(card.locator("[data-stars] svg")).toHaveCount(5);
      const face = card.locator("img.face");
      await expect(face).toHaveAttribute("src", /^\/samples\/avatars\/\w+\.jpg$/);
      await face.evaluate((img: HTMLImageElement) => {
        img.loading = "eager";
      });
      await expect.poll(() => face.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    }
    // A face never changes name: each avatar file belongs to one name across the page.
    const pairs = await page.locator("img.face[data-face]").evaluateAll((imgs) =>
      imgs.map((i) => [i.getAttribute("data-face"), i.getAttribute("src")]),
    );
    const byFile = new Map<string, Set<string>>();
    for (const [id, src] of pairs) byFile.set(src!, (byFile.get(src!) ?? new Set()).add(id!));
    for (const [, ids] of byFile) expect(ids.size).toBe(1);
    expect(bad).toEqual([]);
  });

  test("posters and faces cause no layout shift", async ({ page }) => {
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
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 400) {
        await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
        await page.waitForTimeout(60);
      }
      expect(await page.evaluate(() => (window as Window & { __cls?: number }).__cls)).toBeLessThan(0.01);
    }
  });

  test("sample media files are served with the right types and ranges", async ({ request }) => {
    for (const id of ["maya", "daniel", "aiko"]) {
      const webm = await request.get(`/samples/${id}.webm`);
      expect(webm.status()).toBe(200);
      expect(webm.headers()["content-type"]).toContain("video/webm");
      expect((await webm.body()).length).toBeLessThan(3 * 1024 * 1024);
      const mp4 = await request.get(`/samples/${id}.mp4`);
      expect(mp4.status()).toBe(200);
      expect(mp4.headers()["content-type"]).toContain("video/mp4");
      expect((await request.get(`/samples/${id}.jpg`)).headers()["content-type"]).toContain("image/jpeg");
      const part = await request.get(`/samples/${id}.webm`, { headers: { Range: "bytes=0-1023" } });
      expect(part.status()).toBe(206);
    }
  });

  test("the platforms marquee pauses on hover and focus", async ({ page }) => {
    await page.goto("/");
    const row = page.getByTestId("platform-marquee");
    await row.scrollIntoViewIfNeeded();
    const state = () => row.locator(".marquee-track").evaluate((el) => getComputedStyle(el).animationPlayState);
    expect(await state()).toBe("running");
    await row.hover();
    expect(await state()).toBe("paused");
    await page.mouse.move(0, 0);
    expect(await state()).toBe("running");
    await row.focus();
    expect(await state()).toBe("paused");
    // The second copy is for the loop only.
    await expect(row.locator("ul").nth(1)).toHaveAttribute("aria-hidden", "true");
  });

  test("the layout studio switches layouts and copies its snippet", async ({ page, context, browserName }) => {
    await allowClipboard(context, browserName);
    await page.goto("/");
    const studio = page.getByTestId("section-studio");
    await studio.scrollIntoViewIfNeeded();
    const preview = page.getByTestId("studio-preview");
    await expect(preview).toHaveAttribute("data-layout", "grid");
    const height = await preview.evaluate((el) => el.getBoundingClientRect().height);
    for (const [label, id, cards] of [
      ["Carousel", "carousel", 1],
      ["Slider", "slider", 4],
      ["Marquee", "marquee", 4],
      ["Featured", "featured", 1],
      ["Masonry", "grid", 4],
    ] as const) {
      const button = studio.getByRole("button", { name: label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(preview).toHaveAttribute("data-layout", id);
      await expect(preview.getByTestId("studio-card")).toHaveCount(cards);
      // The preview keeps its size, so the page doesn't jump.
      expect(await preview.evaluate((el) => el.getBoundingClientRect().height)).toBe(height);
    }
    const copy = page.getByTestId("copy-snippet");
    await copy.click();
    await expect(copy).toHaveText("Copied");
    await expect(copy).toHaveAttribute("data-state", "copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('data-widget="w_abc123def456"');
    await expect(copy).toHaveText("Copy", { timeout: 4000 });
  });

  test("self-hosting: the quick start copies with a Copied check", async ({ page, context, browserName }) => {
    await allowClipboard(context, browserName);
    await page.goto("/#self-host");
    const copy = page.getByTestId("copy-setup");
    await copy.click();
    await expect(copy).toHaveText("Copied");
    await expect.poll(() => copy.locator(".copy-check").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text.split("\n")).toEqual([
      "git clone https://github.com/sureshkumaranbu/open-video-testimonial.git plaudit",
      "cd plaudit && cp .env.example .env",
      "docker compose up -d --build",
    ]);
  });

  test("the comparison is a table on desktop and readable cards on a phone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("compare-table")).toBeVisible();
    await expect(page.getByTestId("compare-list")).toBeHidden();
    await expect(page.getByRole("columnheader", { name: "Plaudit" })).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByTestId("compare-table")).toBeHidden();
    const list = page.getByTestId("compare-list");
    await expect(list.locator("li")).toHaveCount(7);
    await expect(list.locator("li").first()).toContainText("Testimonials you can collect");
    await expect(list.locator("li").first()).toContainText("Unlimited");
  });

  test("FAQ opens and closes, by mouse and keyboard", async ({ page }) => {
    await page.goto("/");
    const faq = page.getByTestId("faq");
    const first = faq.getByRole("button", { name: "Is it really free?" });
    await first.scrollIntoViewIfNeeded();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(faq.getByText(/Plaudit is MIT licensed/)).toBeVisible();
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    // Keyboard: arrow to the next question, Enter opens it.
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(faq.getByRole("button", { name: "What do I need to run it?" })).toHaveAttribute("aria-expanded", "true");
    await expect(faq.locator("code", { hasText: "docker compose up" })).toBeVisible();
  });

  test("no horizontal overflow at 360px, and controls are big enough to tap", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    for (const id of SECTIONS) await page.getByTestId(id).scrollIntoViewIfNeeded();
    const widths = await page.evaluate(() => {
      window.scrollTo(600, window.scrollY);
      return { scrollX: window.scrollX, scrollWidth: document.documentElement.scrollWidth, inner: window.innerWidth };
    });
    expect(widths.scrollX).toBe(0);
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.inner);
    // Every visible button, and every link outside running text, is at least 44px tall.
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#home-root button, #home-root header a, #home-root footer a, #home-root [data-slot=button]")]
        .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")
        .filter((el) => !el.closest("[aria-hidden=true]") && !el.classList.contains("sr-only"))
        .map((el) => ({ el: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30), h: el.getBoundingClientRect().height }))
        .filter((r) => r.h < 44),
    );
    expect(small).toEqual([]);
  });

  test("reduced motion shows everything at once and nothing moves", async ({ page, browserName }) => {
    skipLinuxWebkitMedia(browserName);
    const { loaded } = trackSamples(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByTestId("home")).not.toHaveClass(/motion-ok/);
    const moving = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === "running" && (a.effect as KeyframeEffect | null)?.getComputedTiming().iterations === Infinity).length,
    );
    expect(moving).toBe(0);
    const hidden = await page.locator(".wall-tile").evaluateAll((els) =>
      els.filter((el) => getComputedStyle(el).opacity !== "1" || getComputedStyle(el).transform !== "none").length,
    );
    expect(hidden).toBe(0);
    expect(await page.locator(".marquee-track").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // The vignettes show their end state.
    await expect(page.locator("[data-reveal].is-in")).toHaveCount(3);
    expect(await page.locator(".vg-badge-to").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    expect(await page.locator(".vg-badge-from").evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    // No hover preview; a click still plays.
    const tile = page.getByTestId("video-tile").first();
    await tile.hover();
    await page.waitForTimeout(600);
    expect(await tile.locator("video").getAttribute("src")).toBeNull();
    expect(loaded.filter((f) => VIDEO_FILE.test(f))).toEqual([]);
    await tile.getByRole("button", { name: /^Play / }).click();
    await expect(tile).toHaveAttribute("data-state", "playing");
  });

  test("keyboard focus stays visible", async ({ page }) => {
    await page.goto("/");
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const s = getComputedStyle(document.activeElement as HTMLElement);
        return [s.outlineStyle, parseFloat(s.outlineWidth)] as const;
      });
      expect(outline[0]).not.toBe("none");
      expect(outline[1]).toBeGreaterThanOrEqual(2);
    }
  });

  test("theming: PLAUDIT_THEME sets the brand, ?theme= previews another, and invalid names are ignored", async ({ page }) => {
    // The suite's server runs with PLAUDIT_THEME=teal (playwright.config.ts).
    const configured = process.env.E2E_BASE_URL ? null : "teal";
    await page.goto("/");
    if (configured) {
      await expect(page.locator("html")).toHaveAttribute("data-theme", configured);
      expect(await primary(page)).toBe("#0b7a6c");
    }
    await page.goto("/?theme=tomato");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "tomato");
    await expect(page.getByTestId("home")).toHaveAttribute("data-theme", "tomato");
    expect(await primary(page)).toBe("#c8331a");
    // The headline tile is painted in it.
    expect(await page.getByTestId("hero-tile").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(200, 51, 26)");
    await page.goto("/?theme=../../etc");
    await expect(page.getByTestId("home")).toHaveAttribute("data-theme", configured ?? /^(violet|tomato|teal|ink)$/);
    // The dashboard keeps its own look.
    await page.goto("/admin/login");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())).toBe("#161b2e");
  });

  test("theming: the dark toggle applies before paint and persists; system is the default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/?theme=violet");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    expect(await primary(page)).toBe("#5b3df5");
    const toggle = page.getByTestId("mode-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => primary(page)).toBe("#8f78ff");
    expect(await page.evaluate(() => localStorage.getItem("plaudit-mode"))).toBe("dark");

    // After a reload it's dark from the first paint: the boot script ran before any React code.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as Window & { __darkAtDom?: boolean }).__darkAtDom = document.documentElement.classList.contains("dark");
      });
    });
    await page.reload();
    expect(await page.evaluate(() => (window as Window & { __darkAtDom?: boolean }).__darkAtDom)).toBe(true);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(18, 16, 25)");

    // The footer's three-way choice: back to the system setting, which follows the OS.
    const system = page.getByTestId("section-footer").getByRole("radio", { name: "System" });
    await system.click();
    await expect(system).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => localStorage.getItem("plaudit-mode"))).toBeNull();
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  });

  for (const mode of ["light", "dark"] as const) {
    test(`no accessibility violations (axe, ${mode})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.goto("/");
      // Open a FAQ answer so its text is checked too.
      await page.getByTestId("faq").getByRole("button").first().click();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  }

  test("screenshots", async ({ page }) => {
    test.skip(!SHOTS, "only when UPDATE_SCREENSHOTS is set");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForTimeout(1400);
    await shot(page, "home-desktop");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 300) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(400);
    await shot(page, "home-full", true);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForTimeout(1400);
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

  test("copy buttons copy the exact snippet", async ({ page, context, baseURL, browserName }) => {
    await allowClipboard(context, browserName, baseURL!);
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
