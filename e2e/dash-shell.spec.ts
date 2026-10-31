import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/**
 * The dashboard on the theme (phase 2a): the app shell (sidebar, top bar,
 * phone menu), light/dark applied before paint and remembered, the brand
 * from PLAUDIT_THEME, and accessibility in both modes. Public pages keep
 * their own palette whatever the dashboard does.
 */

const RUN = Date.now().toString(36);
const slug = (name: string) => `shell-${name}-${RUN}`;

/** Each brand's --primary, light and dark (src/app/theme.css). */
const BRANDS: Record<string, [string, string]> = {
  violet: ["#5b3df5", "#8f78ff"],
  tomato: ["#c8331a", "#ff6a4d"],
  teal: ["#0b7a6c", "#2fd1bd"],
  ink: ["#1b1530", "#f1eefc"],
};

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

const rootVar = (page: Page, name: string) =>
  page.locator(".admin-root").evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim().toLowerCase(), name);

/** Records, at DOMContentLoaded (before any React code runs), whether <html> was dark and the sidebar collapsed. */
async function recordFirstPaint(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const d = document.documentElement;
      (window as Window & { __boot?: { dark: boolean; sidebar: string | null; bg: string } }).__boot = {
        dark: d.classList.contains("dark"),
        sidebar: d.getAttribute("data-sidebar"),
        bg: getComputedStyle(document.body).backgroundColor,
      };
    });
  });
}
const firstPaint = (page: Page) =>
  page.evaluate(() => (window as Window & { __boot?: { dark: boolean; sidebar: string | null; bg: string } }).__boot);

test.describe("app shell on desktop", () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test("the sidebar lists the project's sections and the dashboard's pages, and collapsing it is remembered", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Shell Co", slug("rail"));
    await signIn(page);
    await page.goto(`/admin/projects/${p.id}`);

    const rail = page.getByTestId("app-sidebar");
    await expect(rail).toBeVisible();
    const sections = rail.getByRole("navigation", { name: "Project sections" });
    await expect(sections.getByRole("link", { name: "Testimonials" })).toHaveAttribute("aria-current", "page");
    // The page's own tab row is for phones; on a desktop the sidebar is the only "Project sections".
    await expect(page.getByRole("navigation", { name: "Project sections" })).toHaveCount(1);
    await sections.getByRole("link", { name: "Requests" }).click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByTestId("app-sidebar").getByRole("link", { name: "Requests" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Shell Co");

    const width = () => page.getByTestId("app-sidebar").evaluate((el) => el.getBoundingClientRect().width);
    const wide = await width();
    expect(wide).toBeGreaterThan(200);
    const collapse = page.getByTestId("sidebar-collapse");
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();
    await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
    await expect(collapse).toHaveAttribute("aria-expanded", "false");
    await expect.poll(width).toBeLessThan(100);
    expect(await page.evaluate(() => localStorage.getItem("plaudit-sidebar"))).toBe("collapsed");
    // Icons only, but every link keeps its name.
    await expect(page.getByTestId("app-sidebar").getByRole("link", { name: "Settings", exact: true })).toBeVisible();

    // A reload draws it collapsed from the first paint, so the page never jumps.
    await recordFirstPaint(page);
    await page.reload();
    expect((await firstPaint(page))?.sidebar).toBe("collapsed");
    expect(await width()).toBeLessThan(100);
    const main = await page.locator("main").first().evaluate((el) => el.getBoundingClientRect().left);
    expect(main).toBeLessThan(wide);

    await page.getByTestId("sidebar-collapse").click();
    await expect(page.locator("html")).not.toHaveAttribute("data-sidebar", /.*/);
    await expect.poll(width).toBeGreaterThan(200);
    expect(await page.evaluate(() => localStorage.getItem("plaudit-sidebar"))).toBeNull();

    // Dashboard pages are reachable from the sidebar.
    await page.getByTestId("app-sidebar").getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.getByTestId("app-sidebar").getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByTestId("nav-projects").click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("the project switcher goes to another project, by pointer and by keyboard", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const a = await createProject(api, `Alpha ${RUN}`, slug("alpha"));
    const b = await createProject(api, `Bravo ${RUN}`, slug("bravo"));
    await signIn(page);
    await page.goto(`/admin/projects/${a.id}`);

    const switcher = page.getByTestId("project-switcher");
    await expect(switcher).toContainText(`Alpha ${RUN}`);
    await switcher.click();
    const menu = page.getByTestId("project-menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: `Bravo ${RUN}` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/projects/${b.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: `Bravo ${RUN}` })).toBeVisible();
    await expect(page.getByTestId("project-switcher")).toContainText(`Bravo ${RUN}`);

    // Keyboard: open, move to the project, choose it.
    await page.getByTestId("project-switcher").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("project-menu")).toBeVisible();
    const target = page.getByTestId("project-menu").getByRole("menuitem", { name: `Alpha ${RUN}` });
    for (let i = 0; i < 40 && !(await target.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/admin/projects/${a.id}$`));

    // "All projects" goes home.
    await page.getByTestId("project-switcher").click();
    await page.getByTestId("project-menu").getByRole("menuitem", { name: "All projects" }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe("app shell on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the menu opens as a sheet, keeps focus inside, closes with Esc, and its links go where they say", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Pocket Co", slug("phone"));
    await signIn(page);
    await page.goto(`/admin/projects/${p.id}`);

    await expect(page.getByTestId("app-sidebar")).toBeHidden();
    const button = page.getByTestId("menu-button");
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await button.click();
    const sheet = page.getByTestId("app-menu");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Testimonials" })).toHaveAttribute("aria-current", "page");

    // Focus stays in the sheet, forwards and backwards.
    const inSheet = () => page.evaluate(() => Boolean(document.activeElement?.closest("[data-testid=app-menu]")));
    expect(await inSheet()).toBe(true);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      expect(await inSheet(), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inSheet(), `Shift+Tab ${i + 1}`).toBe(true);
    }
    // Nothing in it is narrower or shorter than a thumb.
    for (const link of await sheet.getByRole("link").all()) {
      const b = (await link.boundingBox())!;
      if (b.height) expect(b.height, await link.innerText()).toBeGreaterThanOrEqual(44);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(button).toBeFocused();

    // A link in the sheet goes there and closes it; Settings and Sign out are in it too.
    await button.click();
    await sheet.getByRole("link", { name: "Requests" }).click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByTestId("app-menu")).toBeHidden();
    await button.click();
    await expect(page.getByTestId("app-menu").getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.getByTestId("app-menu").getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});

test.describe("light and dark", () => {
  test("the choice applies before paint on every dashboard page, is remembered, and follows the system by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signIn(page);
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await page.getByTestId("mode-picker").getByRole("radio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    expect(await page.evaluate(() => localStorage.getItem("plaudit-mode"))).toBe("dark");
    await expect.poll(() => rootVar(page, "--paper")).toBe("#121019");

    // Dark from the first paint, page after page, sign-in included.
    await recordFirstPaint(page);
    for (const path of ["/admin", "/admin/settings", "/admin/analytics"]) {
      await page.goto(path);
      const boot = await firstPaint(page);
      expect(boot?.dark, path).toBe(true);
      expect(boot?.bg, path).toBe("rgb(18, 16, 25)");
    }
    await page.context().clearCookies();
    await page.goto("/admin/login");
    expect((await firstPaint(page))?.dark).toBe(true);

    // The home page shares the choice.
    await page.goto("/");
    expect((await firstPaint(page))?.dark).toBe(true);

    // Back to the system's setting, which follows the device.
    await signIn(page);
    await page.getByTestId("mode-picker").getByRole("radio", { name: "System" }).click();
    expect(await page.evaluate(() => localStorage.getItem("plaudit-mode"))).toBeNull();
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test("the brand from PLAUDIT_THEME is the dashboard's --primary, in light and dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signIn(page);
    const brand = (await page.locator("html").getAttribute("data-brand"))!;
    expect(Object.keys(BRANDS)).toContain(brand);
    const [light, dark] = BRANDS[brand];
    expect(await rootVar(page, "--primary")).toBe(light);
    // The dashboard's own buttons and focus rings use it (--accent and --focus derive from it).
    expect(await rootVar(page, "--focus")).toBe(await rootVar(page, "--ring"));
    const accent = await page.locator(".admin-root").evaluate((el) => {
      const b = document.createElement("button");
      b.className = "accent";
      b.textContent = "Probe";
      el.appendChild(b);
      const bg = getComputedStyle(b).backgroundColor;
      b.remove();
      return bg;
    });
    const hex = (c: string) => `#${(c.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
    expect(hex(accent)).toBe(light);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect.poll(() => rootVar(page, "--primary")).toBe(dark);
  });

  test("public pages keep their own palette and font while the dashboard is dark", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Public Co", slug("public"));
    await seed(api, p.slug, [{ name: "Pat Public", text: "Still the same page.", status: "approved" }]);
    await page.emulateMedia({ colorScheme: "dark" });
    await signIn(page);
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    for (const path of [`/c/${p.slug}`, `/wall/${p.slug}`]) {
      await page.goto(path);
      const look = await page.evaluate(() => ({
        paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
        font: getComputedStyle(document.body).fontFamily,
        bg: getComputedStyle(document.body).backgroundColor,
      }));
      expect(look.paper, path).toBe("#f6f7f9");
      expect(look.font, path).not.toMatch(/bricolage/i);
      expect(look.bg, path).toBe("rgb(246, 247, 249)");
    }
  });
});

test.describe("accessibility", () => {
  let projectId = "";
  test.beforeAll(async ({ baseURL }) => {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Axe Co", slug("axe"));
    projectId = p.id;
    await seed(api, p.slug, [
      { name: "Ava Axe", text: "Clear to read in any light.", rating: 5, status: "pending" },
      { name: "Ben Bright", text: "The contrast holds up.", rating: 4, status: "approved" },
    ]);
  });

  for (const mode of ["light", "dark"] as const) {
    for (const [name, path] of [
      ["sign-in", "/admin/login"],
      ["dashboard home", "/admin"],
      ["project", "project"],
      ["settings", "/admin/settings"],
    ] as const) {
      test(`no axe violations: ${name}, ${mode}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
        if (path !== "/admin/login") await signIn(page);
        await page.goto(path === "project" ? `/admin/projects/${projectId}` : path);
        await expect(page.locator("html")).toHaveClass(mode === "dark" ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b).*$/);
        await expect(page.locator("main").first()).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        // Each node with axe's own reason (for contrast: the colours it measured), so a failure says why.
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? n.failureSummary ?? ""})`).join("; ")}`)).toEqual([]);
      });
    }
  }
});
