import crypto from "node:crypto";
import { env } from "./env";
import { roleFor, signedOutAt } from "./members";

/**
 * Dashboard sessions. People sign in with the owner's password
 * (ADMIN_EMAIL / ADMIN_PASSWORD), an emailed link, Google or Apple, and a
 * signed, expiring cookie carries the session. Every request checks that the
 * address is still allowed in, so removing someone from the team signs them out.
 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The cookie's name includes a short hash of PUBLIC_URL, so two Plaudit
 * servers on one host (say localhost:3000 and :3001) don't overwrite each
 * other's sessions.
 */
export function sessionCookieName() {
  return `plaudit_session_${crypto.createHash("sha256").update(env.publicUrl).digest("hex").slice(0, 8)}`;
}

export type SignInMethod = "password" | "email" | "google" | "apple" | "oidc";

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

/** A new session, with a fresh random id every time someone signs in. */
export function createSessionToken(email: string, method: SignInMethod = "password", now = Date.now()) {
  const sid = crypto.randomBytes(12).toString("base64url");
  const sub = email.trim().toLowerCase();
  // B-05: issued after the person's last sign-out, even within the same millisecond.
  const iat = Math.max(now, signedOutAt(sub) + 1);
  const payload = Buffer.from(JSON.stringify({ sub, iat, exp: iat + SESSION_TTL_MS, sid, amr: method })).toString("base64url");
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
      iat?: number;
    };
    if (typeof data.exp !== "number" || data.exp < now) return null;
    // Sessions from before B-05 carry no issue time: it's their expiry less the lifetime.
    return { email: data.sub, issuedAt: typeof data.iat === "number" ? data.iat : data.exp - SESSION_TTL_MS };
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token: string) {
  const parts = [
    `${sessionCookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (env.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader() {
  return `${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(req: Request, name: string) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/** A valid session whose address may still sign in, with its role, issued after the person last signed out (B-05). */
export function sessionFromToken(token: string | undefined | null) {
  const session = verifySessionToken(token);
  if (!session || session.issuedAt <= signedOutAt(session.email)) return null;
  const role = roleFor(session.email);
  return role ? { email: session.email, role } : null;
}

/** Returns the session for an API request, or null if not signed in. */
export function getRequestSession(req: Request) {
  return sessionFromToken(readCookie(req, sessionCookieName()));
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
