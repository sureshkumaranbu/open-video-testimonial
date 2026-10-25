import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb } from "@/db";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { resetRateLimits } from "@/lib/rate-limit";

export const ADMIN_EMAIL = "owner@example.com";
export const ADMIN_PASSWORD = "correct horse battery staple";
export const MIGRATIONS_DIR = path.resolve(__dirname, "../drizzle");

/** Points the app at a fresh, empty data directory. */
export function useTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plaudit-test-"));
  closeDb();
  resetRateLimits();
  process.env.DATA_DIR = dir;
  delete process.env.DATABASE_PATH;
  process.env.MIGRATIONS_DIR = MIGRATIONS_DIR;
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

/**
 * Builds databases as an older release left them: points the app at a copy of
 * drizzle/ that stops after journal entry `idx`, so the next getDb() migrates
 * only that far. Seed it, then call `upgrade()`: the next getDb() runs the
 * remaining migrations on the same file, exactly as a server upgrade does.
 * Call after useTempDataDir().
 */
export function useMigrationsUpTo(idx: number) {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const entries = journal.entries.filter((e) => e.idx <= idx);
  if (!entries.some((e) => e.idx === idx)) throw new Error(`No migration with journal idx ${idx}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plaudit-migrations-"));
  fs.mkdirSync(path.join(dir, "meta"));
  for (const e of entries) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
    const snapshot = `${String(e.idx).padStart(4, "0")}_snapshot.json`;
    fs.copyFileSync(path.join(MIGRATIONS_DIR, "meta", snapshot), path.join(dir, "meta", snapshot));
  }
  fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
  closeDb();
  process.env.MIGRATIONS_DIR = dir;
  return {
    dir,
    /** Tags of the migrations still to run. */
    pending: journal.entries.filter((e) => e.idx > idx).map((e) => e.tag),
    upgrade() {
      closeDb();
      process.env.MIGRATIONS_DIR = MIGRATIONS_DIR;
    },
    cleanup() {
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
