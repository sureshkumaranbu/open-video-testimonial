import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb } from "@/db";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { resetRateLimits } from "@/lib/rate-limit";

export const ADMIN_EMAIL = "owner@example.com";
export const ADMIN_PASSWORD = "correct horse battery staple";

/** Points the app at a fresh, empty data directory. */
export function useTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plaudit-test-"));
  closeDb();
  resetRateLimits();
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_PATH;
  process.env.MIGRATIONS_DIR = path.resolve(__dirname, "../drizzle");
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  // Tests stand in for many clients by sending X-Forwarded-For, as a reverse
  // proxy would; tests/rate-limit.test.ts covers TRUST_PROXY being off.
  process.env.TRUST_PROXY = "1";
  return {
    dir,
    cleanup() {
      closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function adminCookie() {
  return `${sessionCookieName()}=${createSessionToken(ADMIN_EMAIL)}`;
}

/** Headers a signed-in browser sends on the dashboard's own requests. */
export function adminHeaders() {
  return { cookie: adminCookie(), "sec-fetch-site": "same-origin" };
}

export function params<T>(value: T) {
  return { params: Promise.resolve(value) };
}

// Minimal valid file headers, enough for the magic-byte sniffer.
export const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 2, 3, 4, 5, 6, 7, 8]);
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

export function submissionForm(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

export function submitRequest(slug: string, form: FormData, ip = "203.0.113.7") {
  return new Request(`http://localhost/api/projects/${slug}/testimonials`, {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": ip },
  });
}

/** A real (short) WebM recording with audio, used by media pipeline tests. */
export const SAMPLE_WEBM = path.resolve(__dirname, "../e2e/fixtures/sample.webm");

let ffmpegChecked: boolean | null = null;

/** Whether ffmpeg is on PATH. CI installs it; tests that need it say so when skipped. */
export function hasFfmpeg() {
  if (ffmpegChecked === null) {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
      ffmpegChecked = true;
    } catch {
      ffmpegChecked = false;
    }
  }
  return ffmpegChecked;
}
