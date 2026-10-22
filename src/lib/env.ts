import path from "node:path";

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
  get jobsPollMs() {
    return Math.max(Number(process.env.JOBS_POLL_MS || 2000), 100);
  },
};
