import crypto from "node:crypto";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3100);
// Set E2E_BASE_URL to test an already-running instance (e.g. `docker compose up`).
const external = process.env.E2E_BASE_URL;
const baseURL = external || `http://127.0.0.1:${PORT}`;

/**
 * A stand-in Google/Apple sign-in server (e2e/fixtures/mock-oidc.mjs), so the
 * suite needs no real accounts. It's on "localhost" while the app is on
 * 127.0.0.1: a different site, so Apple's cross-site form_post is real.
 */
const MOCK_PORT = Number(process.env.E2E_MOCK_OIDC_PORT || 3199);
const mockIssuer = (provider: string) => `http://localhost:${MOCK_PORT}/${provider}`;
const appleKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const APPLE = {
  teamId: "MOCKTEAM01",
  keyId: "MOCKKEY001",
  privateKey: appleKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicKey: appleKey.publicKey.export({ type: "spki", format: "pem" }).toString(),
};

/**
 * The outside web for importers, discovery and chat notifications
 * (e2e/fixtures/fixture-server.mjs): it serves tests/fixtures/** and records
 * what the app sends it. The app reaches it only through the test-only
 * NET_GUARD_ALLOW and IMPORTER_ORIGINS below.
 */
const FIXTURE_PORT = Number(process.env.E2E_FIXTURE_PORT || 3198);
export const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;

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
    : [
        {
          command: "node e2e/fixtures/mock-oidc.mjs",
          url: `http://127.0.0.1:${MOCK_PORT}/google/.well-known/openid-configuration`,
          reuseExistingServer: false,
          env: {
            MOCK_OIDC_PORT: String(MOCK_PORT),
            MOCK_OIDC_HOST: "localhost",
            MOCK_GOOGLE_SECRET: "e2e-google-secret",
            MOCK_APPLE_PUBLIC_KEY: APPLE.publicKey,
            MOCK_APPLE_TEAM_ID: APPLE.teamId,
            MOCK_APPLE_KEY_ID: APPLE.keyId,
          },
        },
        {
          command: "node e2e/fixtures/fixture-server.mjs",
          url: `${FIXTURE_ORIGIN}/__health`,
          reuseExistingServer: false,
          env: { FIXTURE_PORT: String(FIXTURE_PORT), FIXTURE_HOST: "127.0.0.1" },
        },
        {
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
            // Google and Apple sign-in, against the stand-in above.
            GOOGLE_CLIENT_ID: "e2e-google-client",
            GOOGLE_CLIENT_SECRET: "e2e-google-secret",
            GOOGLE_ISSUER: mockIssuer("google"),
            APPLE_CLIENT_ID: "com.example.plaudit.e2e",
            APPLE_TEAM_ID: APPLE.teamId,
            APPLE_KEY_ID: APPLE.keyId,
            APPLE_PRIVATE_KEY: APPLE.privateKey,
            APPLE_ISSUER: mockIssuer("apple"),
            // Lets the team spec sign in people other than the owner.
            ALLOWED_EMAIL_DOMAINS: "team.example",
            // Every Phase 1 feature flag on, so specs see the new pages before release.
            PLAUDIT_FEATURES: "all",
            // The fixture server is on a private address; let exactly that origin
            // through the outbound-request guard (the guard itself stays on).
            NET_GUARD_ALLOW: `127.0.0.1:${FIXTURE_PORT}`,
            // Importers fetch from the fixture server instead of the real sites:
            // "*=<base>" sends adapter <id> to <base>/<id> (tests/fixtures/importers/<id>/).
            IMPORTER_ORIGINS: `*=${FIXTURE_ORIGIN}/importers`,
          },
        },
      ],
});
