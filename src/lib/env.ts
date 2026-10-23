import fs from "node:fs";
import path from "node:path";

const list = (value: string | undefined) =>
  (value || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

/** Runtime configuration. Read lazily so tests can set env vars before use. */
export const env = {
  get dataDir() {
    return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
  },
  get databasePath() {
    return process.env.DATABASE_PATH || path.join(/*turbopackIgnore: true*/ this.dataDir, "plaudit.db");
  },
  get uploadsDir() {
    return path.join(/*turbopackIgnore: true*/ this.dataDir, "uploads");
  },
  get adminEmail() {
    return process.env.ADMIN_EMAIL || "";
  },
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || "";
  },
  /** More people who may sign in to the dashboard (comma-separated). */
  get adminEmails() {
    return list(process.env.ADMIN_EMAILS);
  },
  /** Anyone with a verified address at these domains may sign in, e.g. "acme.com". */
  get allowedEmailDomains() {
    return list(process.env.ALLOWED_EMAIL_DOMAINS).map((d) => d.replace(/^@/, ""));
  },
  /** Email and password sign-in. "false" turns it off once another method works. */
  get passwordLogin() {
    return process.env.PASSWORD_LOGIN !== "false";
  },
  get googleClientId() {
    return process.env.GOOGLE_CLIENT_ID || "";
  },
  get googleClientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET || "";
  },
  /** Google Workspace domain to suggest and require (the `hd` claim). */
  get googleHostedDomain() {
    return (process.env.GOOGLE_HOSTED_DOMAIN || "").trim().toLowerCase();
  },
  /** Only for tests against a stand-in OpenID provider. */
  get googleIssuer() {
    return process.env.GOOGLE_ISSUER || "https://accounts.google.com";
  },
  /** The Services ID, e.g. com.acme.plaudit.signin. */
  get appleClientId() {
    return process.env.APPLE_CLIENT_ID || "";
  },
  get appleTeamId() {
    return process.env.APPLE_TEAM_ID || "";
  },
  get appleKeyId() {
    return process.env.APPLE_KEY_ID || "";
  },
  /** The .p8 key's contents (APPLE_PRIVATE_KEY), or a path to it (APPLE_PRIVATE_KEY_FILE). */
  get applePrivateKey() {
    const inline = (process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
    if (inline) return inline;
    const file = process.env.APPLE_PRIVATE_KEY_FILE;
    if (!file) return "";
    try {
      return fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
    } catch {
      return "";
    }
  },
  /** Only for tests against a stand-in OpenID provider. */
  get appleIssuer() {
    return process.env.APPLE_ISSUER || "https://appleid.apple.com";
  },
  get sessionSecret() {
    const secret = process.env.SESSION_SECRET || "";
    if (secret.length < 16) {
      throw new Error("SESSION_SECRET must be set to at least 16 characters");
    }
    return secret;
  },
  get publicUrl() {
    return (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
  get maxVideoBytes() {
    return Number(process.env.MAX_VIDEO_MB || 200) * 1024 * 1024;
  },
  get maxImageBytes() {
    return Number(process.env.MAX_IMAGE_MB || 5) * 1024 * 1024;
  },
  get cookieSecure() {
    return process.env.COOKIE_SECURE === "true";
  },
  /**
   * How many reverse proxies sit in front of Plaudit and append the client's
   * address to X-Forwarded-For. "true" means one. 0 (the default) ignores
   * forwarding headers, which any client could otherwise make up.
   */
  get trustProxyHops() {
    const v = (process.env.TRUST_PROXY || "").trim().toLowerCase();
    if (v === "true" || v === "yes") return 1;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? Math.min(n, 10) : 0;
  },
  get tmpDir() {
    return path.join(/*turbopackIgnore: true*/ this.dataDir, "tmp");
  },
  /** ffmpeg/ffprobe binaries. Set MEDIA_PROCESSING=off to serve uploads untouched. */
  get ffmpegPath() {
    return process.env.FFMPEG_PATH || "ffmpeg";
  },
  get ffprobePath() {
    return process.env.FFPROBE_PATH || "ffprobe";
  },
  get mediaProcessing() {
    return process.env.MEDIA_PROCESSING !== "off";
  },
  /** The background worker runs inside the server process unless turned off. */
  get workerEnabled() {
    return process.env.JOBS_WORKER !== "off";
  },
  /**
   * Speech-to-text for transcripts and captions: "off" (default), "openai"
   * (any OpenAI-compatible /audio/transcriptions endpoint) or "command"
   * (a local program such as whisper.cpp).
   */
  get transcribeProvider(): "off" | "openai" | "command" {
    const p = (process.env.TRANSCRIBE_PROVIDER || "off").toLowerCase();
    return p === "openai" || p === "command" ? p : "off";
  },
  get transcribeApiUrl() {
    return (process.env.TRANSCRIBE_API_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  },
  get transcribeApiKey() {
    return process.env.TRANSCRIBE_API_KEY || "";
  },
  get transcribeModel() {
    return process.env.TRANSCRIBE_MODEL || "whisper-1";
  },
  get transcribeLanguage() {
    return process.env.TRANSCRIBE_LANGUAGE || "";
  },
  get transcribeCommand() {
    return process.env.TRANSCRIBE_COMMAND || "";
  },
  /** Store a keyed hash of the submitter's IP with each consent record. Off by default. */
  get consentIpHash() {
    return process.env.CONSENT_IP_HASH === "true";
  },
  /** Outgoing mail server, e.g. smtps://user:pass@smtp.example.com:465 */
  get smtpUrl() {
    return process.env.SMTP_URL || "";
  },
  /**
   * Or the same thing in parts, so a password with special characters needn't
   * be URL-encoded. SMTP_URL wins when both are set.
   */
  get smtpHost() {
    return process.env.SMTP_HOST || "";
  },
  get smtpPort() {
    return Number(process.env.SMTP_PORT) || 0;
  },
  get smtpUser() {
    return process.env.SMTP_USER || "";
  },
  get smtpPassword() {
    return process.env.SMTP_PASSWORD || "";
  },
  /** Implicit TLS (usually port 465). Unset means "on for port 465". */
  get smtpSecure() {
    const v = (process.env.SMTP_SECURE || "").trim().toLowerCase();
    return v === "" ? null : v === "true";
  },
  get smtpFrom() {
    return process.env.SMTP_FROM || "Plaudit <no-reply@localhost>";
  },
  get smtpFromSet() {
    return Boolean(process.env.SMTP_FROM);
  },
  /** Write emails to DATA_DIR/mail-outbox instead of sending (for local testing). */
  get mailOutbox() {
    return process.env.MAIL_OUTBOX === "true";
  },
  /** Largest export archive accepted for import (megabytes). */
  get maxImportBytes() {
    return Number(process.env.MAX_IMPORT_MB || 10240) * 1024 * 1024;
  },
  /** Let CSV imports download media from private-network addresses. */
  get importAllowPrivateUrls() {
    return process.env.IMPORT_ALLOW_PRIVATE_URLS === "true";
  },
  get jobsPollMs() {
    return Math.max(Number(process.env.JOBS_POLL_MS || 2000), 100);
  },
};
