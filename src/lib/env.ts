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
};
