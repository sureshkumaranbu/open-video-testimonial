import crypto from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { LoginTokenPurpose } from "@/db/schema";
import { normalizeEmail } from "./members";

/**
 * Single-use sign-in and invitation links. Only a SHA-256 of each token is
 * stored. A sign-in link works only in the browser that asked for it (it
 * holds a secret cookie), and every link needs a click on a confirmation
 * page, so mail scanners that open links can't use them up.
 */

export const SIGN_IN_TTL_MS = 15 * 60 * 1000;
/** Invitations wait longer; an expired one is no loss, as the invitee can ask for a sign-in link. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const LINK_COOKIE = "plaudit_link";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("base64url");
export const randomSecret = () => crypto.randomBytes(32).toString("base64url");

export function createLoginToken(email: string, purpose: LoginTokenPurpose, browserSecret?: string, now = Date.now()) {
  const token = randomSecret();
  getDb()
    .insert(schema.loginTokens)
    .values({
      id: crypto.randomUUID(),
      tokenHash: hash(token),
      email: normalizeEmail(email),
      purpose,
      browserHash: browserSecret ? hash(browserSecret) : null,
      createdAt: new Date(now),
      expiresAt: new Date(now + (purpose === "invite" ? INVITE_TTL_MS : SIGN_IN_TTL_MS)),
    })
    .run();
  return token;
}

export type LinkProblem = "invalid" | "expired" | "used" | "other-browser";

/** Said whether or not the address may sign in, so the form can't be used to find out who can. */
export const LINK_SENT = "If this address can sign in, we've sent it a link. It works for 15 minutes, in this browser.";

export const LINK_PROBLEMS: Record<LinkProblem | "not-allowed", string> = {
  invalid: "This link isn't valid. Ask for a new one.",
  expired: "This link has expired. Ask for a new one.",
  used: "This link has already been used. Ask for a new one.",
  "other-browser": "Open this link in the same browser where you asked for it, or ask for a new one here.",
  "not-allowed": "This address can't sign in any more. Ask the owner to invite you again.",
};

function find(token: string) {
  if (!token || token.length > 200) return undefined;
  return getDb().select().from(schema.loginTokens).where(eq(schema.loginTokens.tokenHash, hash(token))).get();
}

function problemWith(row: ReturnType<typeof find>, browserSecret: string | undefined, now: number): LinkProblem | null {
  if (!row) return "invalid";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now) return "expired";
  if (row.browserHash) {
    const given = Buffer.from(browserSecret ? hash(browserSecret) : "");
    const want = Buffer.from(row.browserHash);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return "other-browser";
  }
  return null;
}

/** Looks a link up without using it, for the confirmation page. */
export function peekLoginToken(token: string, browserSecret?: string, now = Date.now()) {
  const row = find(token);
  const problem = problemWith(row, browserSecret, now);
  return problem ? { problem } : { email: row!.email, purpose: row!.purpose };
}

/** Uses a link up. Exactly one request can succeed, even if several race. */
export function consumeLoginToken(token: string, browserSecret?: string, now = Date.now()) {
  const row = find(token);
  const problem = problemWith(row, browserSecret, now);
  if (problem) return { problem };
  const claimed = getDb()
    .update(schema.loginTokens)
    .set({ usedAt: new Date(now) })
    .where(and(eq(schema.loginTokens.id, row!.id), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date(now))))
    .returning()
    .get();
  if (!claimed) return { problem: "used" as const };
  return { email: claimed.email, purpose: claimed.purpose };
}

/** Deletes links that expired or were used more than a day ago. */
export function cleanupLoginTokens(now = Date.now()) {
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  return getDb()
    .delete(schema.loginTokens)
    .where(or(lt(schema.loginTokens.expiresAt, dayAgo), lt(schema.loginTokens.usedAt, dayAgo)))
    .run().changes;
}

export function linkCookieHeader(secret: string, secure: boolean) {
  return `${LINK_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SIGN_IN_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
}

export function clearLinkCookieHeader() {
  return `${LINK_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
