import crypto from "node:crypto";
import { env } from "./env";

/**
 * Single-owner auth: the owner's credentials come from ADMIN_EMAIL /
 * ADMIN_PASSWORD, and a signed, expiring cookie carries the session.
 */
export const SESSION_COOKIE = "plaudit_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string) {
  return crypto.createHmac("sha256", env.sessionSecret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Compare digests so length differences don't leak through timing.
  const ah = crypto.createHash("sha256").update(ab).digest();
  const bh = crypto.createHash("sha256").update(bb).digest();
  return crypto.timingSafeEqual(ah, bh) && ab.length === bb.length;
}

export function checkCredentials(email: string, password: string) {
  if (!env.adminEmail || !env.adminPassword) return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), env.adminEmail.trim().toLowerCase());
  const passwordOk = safeEqual(password, env.adminPassword);
  return emailOk && passwordOk;
}

export function createSessionToken(email: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub: email, exp: now + SESSION_TTL_MS })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      sub: string;
      exp: number;
    };
    if (typeof data.exp !== "number" || data.exp < now) return null;
    return { email: data.sub };
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token: string) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (env.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(req: Request, name: string) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/** Returns the session for an API request, or null if not signed in. */
export function getRequestSession(req: Request) {
  return verifySessionToken(readCookie(req, SESSION_COOKIE));
}

/**
 * Rejects requests whose Origin doesn't match the host, as a CSRF guard on
 * top of SameSite=Lax cookies. Lenient: a request with no Origin passes, so
 * scripts can sign in; anything that acts with the session cookie must also
 * pass isSameSiteRequest.
 */
export function isSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Strict check for state-changing requests authenticated by the session
 * cookie: the browser must vouch that the request comes from this site,
 * with a matching Origin or, when Origin is missing, Sec-Fetch-Site:
 * same-origin. A request that carries neither is refused. API-key routes
 * don't use cookies and aren't affected.
 */
export function isSameSiteRequest(req: Request) {
  if (req.headers.get("origin")) return isSameOrigin(req);
  return req.headers.get("sec-fetch-site") === "same-origin";
}
