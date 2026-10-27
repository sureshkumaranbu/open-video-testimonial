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
  /**
   * INBOX-13 machine translation with your own provider: "off" (default),
   * "deepl", "libretranslate" or "openai" (any OpenAI-compatible
   * /chat/completions endpoint). Nothing is sent anywhere until it's set.
   */
  get translateProvider(): "off" | "deepl" | "libretranslate" | "openai" {
    const p = (process.env.TRANSLATE_PROVIDER || "off").trim().toLowerCase();
    return p === "deepl" || p === "libretranslate" || p === "openai" ? p : "off";
  },
  /** The provider's base address; DeepL's free API and OpenAI's are the defaults, LibreTranslate needs one. */
  get translateApiUrl() {
    const fallback = this.translateProvider === "deepl" ? "https://api-free.deepl.com" : this.translateProvider === "openai" ? "https://api.openai.com/v1" : "";
    return (process.env.TRANSLATE_API_URL || fallback).trim().replace(/\/+$/, "");
  },
  get translateApiKey() {
    return process.env.TRANSLATE_API_KEY || "";
  },
  /** The model, for "openai" only (required there). */
  get translateModel() {
    return (process.env.TRANSLATE_MODEL || "").trim();
  },
  /**
   * INBOX-14 smart search with your own OpenAI-compatible /embeddings endpoint
   * (EMBEDDINGS_API_URL, EMBEDDINGS_API_KEY, EMBEDDINGS_MODEL). Off until a
   * model is set; testimonial text is then sent to that provider.
   */
  get embeddingsApiUrl() {
    return (process.env.EMBEDDINGS_API_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  },
  get embeddingsApiKey() {
    return process.env.EMBEDDINGS_API_KEY || "";
  },
  get embeddingsModel() {
    return (process.env.EMBEDDINGS_MODEL || "").trim();
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

  // ------------------------------------------------------------- Phase 1

  /**
   * Phase 1 sections that are switched on (see src/lib/features.ts): a comma
   * list, or "all" (the default since release). Set it to "none" to hide them all.
   */
  get features() {
    return process.env.PLAUDIT_FEATURES === undefined ? ["all"] : list(process.env.PLAUDIT_FEATURES);
  },
  /** Where media files live: "local" (DATA_DIR/uploads, the default) or "s3" (any S3-compatible service). */
  get storageDriver(): "local" | "s3" {
    return (process.env.STORAGE_DRIVER || "").trim().toLowerCase() === "s3" ? "s3" : "local";
  },
  /** e.g. https://<account>.r2.cloudflarestorage.com or http://localhost:9000 (MinIO). Empty means AWS in S3_REGION. */
  get s3Endpoint() {
    const set = (process.env.S3_ENDPOINT || "").trim().replace(/\/+$/, "");
    return set || `https://s3.${this.s3Region}.amazonaws.com`;
  },
  /** R2 uses "auto". */
  get s3Region() {
    return (process.env.S3_REGION || "").trim() || "us-east-1";
  },
  get s3Bucket() {
    return (process.env.S3_BUCKET || "").trim();
  },
  get s3AccessKeyId() {
    return process.env.S3_ACCESS_KEY_ID || "";
  },
  get s3SecretAccessKey() {
    return process.env.S3_SECRET_ACCESS_KEY || "";
  },
  /** Bucket in the path (http://host/bucket/key) rather than the host name. MinIO usually needs it. */
  get s3ForcePathStyle() {
    return process.env.S3_FORCE_PATH_STYLE === "true";
  },
  /** Folder for Plaudit's objects inside the bucket: "" or "name/" (always one trailing slash). */
  get s3Prefix() {
    const p = (process.env.S3_PREFIX || "").trim().replace(/^\/+|\/+$/g, "");
    return p ? `${p}/` : "";
  },
  /** Your own key for the Google review importer (Places API). */
  get googlePlacesApiKey() {
    return process.env.GOOGLE_PLACES_API_KEY || "";
  },
  /** Your own token for the Product Hunt importer (GraphQL API v2). */
  get productHuntToken() {
    return process.env.PRODUCT_HUNT_TOKEN || "";
  },
  /** Your own YouTube Data API v3 key, for importing a video's comments (M13); without it a video link imports as itself. */
  get youtubeApiKey() {
    return process.env.YOUTUBE_API_KEY || "";
  },
  /** Your own Etsy Open API v3 key (keystring), for importing your shop's reviews (M13). */
  get etsyApiKey() {
    return process.env.ETSY_API_KEY || "";
  },
  /** Days a trashed testimonial is kept before it's deleted for good. */
  get trashRetentionDays() {
    const n = Number(process.env.TRASH_RETENTION_DAYS || 30);
    return Number.isInteger(n) && n > 0 ? n : 30;
  },
  /**
   * Cookieless analytics (M11): "off" stops all collection (nothing is stored)
   * and hides the analytics pages. On by default.
   */
  get analytics() {
    return !["off", "false", "0"].includes((process.env.ANALYTICS || "").trim().toLowerCase());
  },
  /** Hour of the day (UTC, 0–23) when daily and weekly digest emails go out. */
  get digestHourUtc() {
    const n = Number(process.env.DIGEST_HOUR_UTC || 8);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 8;
  },
  /**
   * Only for tests: exact host:port origins (e.g. "127.0.0.1:3198") that
   * outbound requests may reach although they're private addresses or not on a
   * chat channel's host allowlist. The guard itself stays on.
   */
  get netGuardAllow() {
    return list(process.env.NET_GUARD_ALLOW);
  },
  // ------------------------------------------------------------- M14

  /**
   * Generic OpenID Connect sign-in (TEAM-03: Okta, Microsoft Entra ID,
   * Authentik, Keycloak…): the issuer URL, whose
   * /.well-known/openid-configuration Plaudit reads. Off while it's empty.
   */
  get oidcIssuer() {
    return (process.env.OIDC_ISSUER || "").trim();
  },
  get oidcClientId() {
    return (process.env.OIDC_CLIENT_ID || "").trim();
  },
  get oidcClientSecret() {
    return process.env.OIDC_CLIENT_SECRET || "";
  },
  /** The sign-in button's name, as in "Continue with Okta". */
  get oidcLabel() {
    return (process.env.OIDC_LABEL || "").trim().slice(0, 40) || "single sign-on";
  },
  /** Scopes to ask for; "openid" is always included. */
  get oidcScopes() {
    const asked = (process.env.OIDC_SCOPES || "openid email profile").split(/[\s,]+/).filter(Boolean);
    return [...new Set(["openid", ...asked])].join(" ");
  },
  /**
   * Only accept addresses at these domains from the OIDC provider (comma
   * list). An extra check: it doesn't let anyone in by itself.
   */
  get oidcEmailDomains() {
    return list(process.env.OIDC_EMAIL_DOMAINS).map((d) => d.replace(/^@/, ""));
  },
  /**
   * "true" accepts addresses the provider doesn't mark email_verified (Entra
   * ID leaves the claim out). Only for a provider whose addresses you control.
   */
  get oidcTrustEmail() {
    return process.env.OIDC_TRUST_EMAIL === "true";
  },
  /**
   * Only for tests: where importers fetch from instead of the real sites, as
   * "<adapter>=<base>" pairs. "*=<base>" sends every adapter to <base>/<adapter>.
   */
  get importerOrigins(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const pair of (process.env.IMPORTER_ORIGINS || "").split(",")) {
      const at = pair.indexOf("=");
      if (at <= 0) continue;
      const id = pair.slice(0, at).trim().toLowerCase();
      const base = pair.slice(at + 1).trim().replace(/\/+$/, "");
      if (id && base) map[id] = base;
    }
    return map;
  },
};
