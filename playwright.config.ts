import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3100);
// Set E2E_BASE_URL to test an already-running instance (e.g. `docker compose up`).
const external = process.env.E2E_BASE_URL;
const baseURL = external || `http://127.0.0.1:${PORT}`;

export const E2E_ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL || "owner@example.com",
  password: process.env.E2E_ADMIN_PASSWORD || "e2e-password-123",
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    permissions: ["camera", "microphone"],
    launchOptions: {
      // Chromium's fake camera/mic let the in-browser recorder run headless.
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : {
        // Production build, served by the standalone server the Docker image uses.
        command: "rm -rf .e2e-data && npm run build && npm start",
        url: baseURL,
        timeout: 300_000,
        reuseExistingServer: false,
        env: {
          PORT: String(PORT),
          HOSTNAME: "127.0.0.1",
          DATA_DIR: ".e2e-data",
          PUBLIC_URL: baseURL,
          SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
          ADMIN_EMAIL: E2E_ADMIN.email,
          ADMIN_PASSWORD: E2E_ADMIN.password,
          NEXT_TELEMETRY_DISABLED: "1",
          // The suite stands in for many visitors by sending X-Forwarded-For,
          // as a reverse proxy would (see useFreshIp in e2e/helpers.ts).
          TRUST_PROXY: "1",
          // Run background jobs (video conversion, email, webhooks) promptly.
          JOBS_POLL_MS: "300",
          // Emails are written to .e2e-data/mail-outbox, where the tests read them.
          MAIL_OUTBOX: "true",
          // A stand-in for whisper.cpp so transcripts and captions run end to end.
          TRANSCRIBE_PROVIDER: "command",
          TRANSCRIBE_COMMAND: `"${process.execPath}" "${path.resolve(__dirname, "e2e/fixtures/fake-whisper.mjs")}" {input} {output}`,
        },
      },
});
