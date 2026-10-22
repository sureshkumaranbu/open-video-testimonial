import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_ADMIN } from "../playwright.config";

export const FIXTURES = path.join(__dirname, "fixtures");
export const SHOTS = process.env.UPDATE_SCREENSHOTS ? path.join(__dirname, "..", "docs", "screenshots") : null;

let ipCounter = Math.floor(Math.random() * 200);

/**
 * A fresh client IP per test. The app rate-limits submissions and sign-ins
 * per IP (taken from X-Forwarded-For), so a long suite run from one machine
 * would otherwise trip its own limits.
 */
export function freshIp() {
  ipCounter = (ipCounter + 1) % 250;
  return `198.18.${Math.floor(Math.random() * 250)}.${ipCounter + 1}`;
}

export async function useFreshIp(page: Page) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": freshIp() });
}

export async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** A signed-in API client for seeding data quickly. */
export async function adminApi(baseURL: string): Promise<APIRequestContext> {
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
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
};

/** Submits through the public endpoint (as a customer would), then moderates. */
export async function seed(api: APIRequestContext, slug: string, items: Seed[]) {
  const ids: string[] = [];
  for (const item of items) {
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

/** Saves a screenshot to docs/screenshots/ when UPDATE_SCREENSHOTS is set. */
export async function shot(page: Page, name: string, fullPage = false) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}
