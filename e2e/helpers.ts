import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { expect, request as pwRequest, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { E2E_ADMIN, FIXTURE_ORIGIN } from "../playwright.config";
import type { CannedResponse, RecordedRequest } from "./fixtures/fixture-server.mjs";

export const FIXTURES = path.join(__dirname, "fixtures");
export const SHOTS = process.env.UPDATE_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots") : null;
/** Where the suite's own server writes emails (MAIL_OUTBOX=true). */
export const OUTBOX = path.resolve(__dirname, "..", ".e2e-data", "mail-outbox");

let ipCounter = Math.floor(Math.random() * 200);

/**
 * A fresh client IP per test. The app rate-limits submissions and sign-ins
 * per IP, taken from X-Forwarded-For because the test server runs with
 * TRUST_PROXY=1; a long suite run from one machine would otherwise trip its
 * own limits.
 */
export function freshIp() {
  ipCounter = (ipCounter + 1) % 250;
  return `198.18.${Math.floor(Math.random() * 250)}.${ipCounter + 1}`;
}

export async function useFreshIp(page: Page) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": freshIp() });
}

/**
 * Skips a test that depends on how video loads or plays when it runs in
 * Playwright's Linux WebKit (the CI runner). That build plays media through
 * GStreamer, which preloads clips and loads caption tracks differently from
 * Safari on macOS and iOS, the WebKit real visitors use. These tests still
 * run in Chromium everywhere and in WebKit on macOS.
 */
export function skipLinuxWebkitMedia(browserName: string) {
  test.skip(browserName === "webkit" && process.platform === "linux", "Linux WebKit's GStreamer media stack loads video unlike Safari (runs in Chromium, and in WebKit on macOS)");
}

/**
 * Lets a test read back what the page copied. Chromium gets the real
 * clipboard permissions. WebKit has none to grant (Playwright answers
 * "Unknown permission: clipboard-write") and its readText() waits for a real
 * paste gesture, so there, as a test-only workaround, navigator.clipboard is
 * an in-memory stand-in installed before the page loads. The app's copy code
 * runs unchanged; only the system clipboard is replaced. The text is kept in
 * sessionStorage so it survives a navigation within the tab.
 */
export async function allowClipboard(context: BrowserContext, browserName: string, origin?: string) {
  if (browserName !== "webkit") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], origin ? { origin } : undefined);
    return;
  }
  await context.addInitScript(() => {
    const KEY = "e2e:clipboard";
    const clipboard = {
      writeText: async (text: string) => sessionStorage.setItem(KEY, String(text)),
      readText: async () => sessionStorage.getItem(KEY) ?? "",
    };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  });
}

export async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** A signed-in API client for seeding data quickly. */
export async function adminApi(baseURL: string): Promise<APIRequestContext> {
  // Origin: the dashboard's own requests carry it, and admin changes require it.
  const api = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": freshIp(), origin: new URL(baseURL).origin },
  });
  const res = await api.post("/api/admin/login", { data: E2E_ADMIN });
  expect(res.ok()).toBe(true);
  return api;
}

export async function createProject(api: APIRequestContext, name: string, slug: string) {
  const res = await api.post("/api/admin/projects", { data: { name, slug } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).project as { id: string; slug: string };
}

export type Seed = {
  name: string;
  text?: string;
  email?: string;
  rating?: number;
  video?: boolean;
  status?: "pending" | "approved" | "rejected";
  tags?: string[];
  /** Send through this step-by-step form instead of the classic endpoint. */
  formSlug?: string;
  /** Written answers by question key (form mode); `text` answers the first question when left out. */
  answers?: Record<string, string>;
  customFields?: Record<string, string | number | boolean>;
  hiddenFields?: Record<string, string>;
};

/** One seed through a form's submissions endpoint (written answers only). */
async function seedThroughForm(api: APIRequestContext, slug: string, item: Seed) {
  const answers = Object.entries(item.answers ?? { q1: item.text ?? "" }).map(([key, text]) => ({ key, text }));
  const payload = {
    ...(item.rating ? { rating: item.rating } : {}),
    answers,
    person: { name: item.name, ...(item.email ? { email: item.email } : {}) },
    customFields: item.customFields ?? {},
    hiddenFields: item.hiddenFields ?? {},
    consent: { agreed: true },
  };
  return api.post(`/api/projects/${slug}/forms/${item.formSlug}/submissions`, {
    multipart: { payload: JSON.stringify(payload) },
    headers: { "x-forwarded-for": freshIp() },
  });
}

/** Submits through the public endpoint (as a customer would), then moderates. */
export async function seed(api: APIRequestContext, slug: string, items: Seed[]) {
  const ids: string[] = [];
  for (const item of items) {
    if (item.formSlug) {
      const res = await seedThroughForm(api, slug, item);
      expect(res.status(), await res.text()).toBe(201);
      const { id } = await res.json();
      ids.push(id);
      if (item.status || item.tags) {
        const patch = await api.patch(`/api/admin/testimonials/${id}`, {
          data: { ...(item.status ? { status: item.status } : {}), ...(item.tags ? { tags: item.tags } : {}) },
        });
        expect(patch.ok()).toBe(true);
      }
      continue;
    }
    const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
      name: item.name,
      consent: "on",
    };
    if (item.text) multipart.text = item.text;
    if (item.email) multipart.email = item.email;
    if (item.rating) multipart.rating = String(item.rating);
    if (item.video) {
      multipart.video = {
        name: "clip.webm",
        mimeType: "video/webm",
        buffer: fs.readFileSync(path.join(FIXTURES, "sample.webm")),
      };
    }
    const res = await api.post(`/api/projects/${slug}/testimonials`, {
      multipart,
      headers: { "x-forwarded-for": freshIp() },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { id } = await res.json();
    ids.push(id);
    if (item.status || item.tags) {
      const patch = await api.patch(`/api/admin/testimonials/${id}`, {
        data: { ...(item.status ? { status: item.status } : {}), ...(item.tags ? { tags: item.tags } : {}) },
      });
      expect(patch.ok()).toBe(true);
    }
  }
  return ids;
}

/** Serves arbitrary HTML pages from a different origin than the app. */
export async function startHostServer() {
  const pages: Record<string, string> = {};
  const server = http.createServer((req, res) => {
    const body = pages[req.url ?? ""];
    res.writeHead(body ? 200 : 404, { "Content-Type": "text/html" });
    res.end(body ?? "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  return {
    url,
    pages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A deliberately hostile host page: aggressive global CSS the widget must ignore. */
export function hostPage(title: string, body: string) {
  return `<!doctype html><html><head><title>${title}</title>
<style>*{color:red !important;font-family:"Comic Sans MS",cursive !important;letter-spacing:3px}
article,div{background:hotpink;border:4px solid lime}</style></head>
<body><h1>${title}</h1>${body}</body></html>`;
}

/**
 * A URL on the fixture server (e2e/fixtures/fixture-server.mjs), which serves
 * tests/fixtures/**: fixtureUrl("importers/appstore/feed.json"). It runs only
 * with the suite's own server, so specs that need it skip when E2E_BASE_URL is set.
 */
export function fixtureUrl(p = "") {
  return `${FIXTURE_ORIGIN}/${p.replace(/^\/+/, "")}`;
}

/** What the app sent to the fixture server (oldest first), e.g. a chat webhook POST. */
export async function fixtureRequests(pathPrefix = "/", method?: string): Promise<RecordedRequest[]> {
  const q = new URLSearchParams({ path: pathPrefix, ...(method ? { method } : {}) });
  const res = await fetch(`${FIXTURE_ORIGIN}/__requests?${q}`);
  expect(res.ok).toBe(true);
  return res.json();
}

/** Makes the fixture server answer `path` this way (status, body, delay), e.g. to test retries. */
export async function fixtureRespond(response: CannedResponse) {
  const res = await fetch(`${FIXTURE_ORIGIN}/__responses`, { method: "PUT", body: JSON.stringify(response) });
  expect(res.ok).toBe(true);
}

/** Forgets recorded requests and canned answers. */
export async function resetFixtures() {
  for (const p of ["/__requests", "/__responses"]) {
    expect((await fetch(`${FIXTURE_ORIGIN}${p}`, { method: "DELETE" })).ok).toBe(true);
  }
}

function decodeMail(raw: string) {
  const body = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n");
  return /quoted-printable/i.test(raw)
    ? Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8")
    : body;
}

/**
 * Waits for an email to `to` whose headers match `subject` (e.g.
 * /Subject: New testimonial/), and returns its decoded text. Reads the outbox
 * of the suite's own server, so specs using it skip when E2E_BASE_URL is set.
 */
export async function waitForMail(to: string, subject: RegExp, timeout = 20_000) {
  let found = "";
  await expect
    .poll(
      () => {
        if (!fs.existsSync(OUTBOX)) return false;
        for (const file of fs.readdirSync(OUTBOX).sort()) {
          const raw = fs.readFileSync(path.join(OUTBOX, file), "utf8");
          const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
          if (head.includes(`To: ${to}`) && subject.test(head)) {
            found = decodeMail(raw);
            return true;
          }
        }
        return false;
      },
      { timeout, message: `an email to ${to} matching ${subject}` },
    )
    .toBe(true);
  return found;
}

/** Saves a screenshot to docs/screenshots/ when UPDATE_SCREENSHOTS is set. */
export async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  // A sticky header is drawn where the viewport is, so start full-page shots at the top.
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}
