import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { getDb, schema } from "@/db";
import { env } from "./env";

/**
 * Sign in with Google or Apple (OpenID Connect, authorization code flow).
 * Each sign-in gets a random state, nonce and (for Google) PKCE verifier,
 * kept server-side for 10 minutes and tied to the browser by a cookie. The
 * id_token is checked against the provider's published keys: issuer,
 * audience, expiry, nonce and a verified email address.
 */

export type Provider = "google" | "apple";
export const PROVIDERS: Provider[] = ["google", "apple"];
export const FLOW_COOKIE = "plaudit_oauth";
const FLOW_TTL_MS = 10 * 60 * 1000;

export class SignInError extends Error {
  constructor(
    /** Shown on the sign-in page as ?error=… */
    readonly reason: "not-configured" | "expired" | "failed" | "unverified" | "wrong-domain" | "cancelled",
    message: string,
  ) {
    super(message);
  }
}

/** What each provider needs, and which of it is missing. */
export function providerStatus(provider: Provider) {
  const required: [string, string][] =
    provider === "google"
      ? [
          ["GOOGLE_CLIENT_ID", env.googleClientId],
          ["GOOGLE_CLIENT_SECRET", env.googleClientSecret],
        ]
      : [
          ["APPLE_CLIENT_ID", env.appleClientId],
          ["APPLE_TEAM_ID", env.appleTeamId],
          ["APPLE_KEY_ID", env.appleKeyId],
          ["APPLE_PRIVATE_KEY", env.applePrivateKey],
        ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  return { enabled: missing.length === 0, missing, partly: missing.length > 0 && missing.length < required.length };
}

export const callbackUrl = (provider: Provider) => `${env.publicUrl}/api/auth/callback/${provider}`;
const issuerOf = (provider: Provider) => (provider === "google" ? env.googleIssuer : env.appleIssuer).replace(/\/+$/, "");
const clientIdOf = (provider: Provider) => (provider === "google" ? env.googleClientId : env.appleClientId);

// ------------------------------------------------------------------ discovery

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
const discoveries = new Map<string, { at: number; doc: Discovery; jwks: JWTVerifyGetKey }>();

async function discover(provider: Provider) {
  const issuer = issuerOf(provider);
  const cached = discoveries.get(issuer);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new SignInError("failed", `Couldn't reach ${provider === "google" ? "Google" : "Apple"} (${res.status})`);
  const doc = (await res.json()) as Discovery;
  const entry = { at: Date.now(), doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  discoveries.set(issuer, entry);
  return entry;
}

// ------------------------------------------------------------------ the flow

const random = () => crypto.randomBytes(32).toString("base64url");
const s256 = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");

/** Starts a sign-in: returns the provider URL to send the browser to, and the flow id for its cookie. */
export async function startSignIn(provider: Provider, now = Date.now()) {
  if (!providerStatus(provider).enabled) throw new SignInError("not-configured", `${provider} sign-in isn't set up`);
  const { doc } = await discover(provider);
  const flow = { id: random(), provider, state: random(), nonce: random(), codeVerifier: random() };
  const db = getDb();
  db.delete(schema.oauthFlows).where(lt(schema.oauthFlows.expiresAt, new Date(now))).run();
  db.insert(schema.oauthFlows).values({ ...flow, createdAt: new Date(now), expiresAt: new Date(now + FLOW_TTL_MS) }).run();

  const url = new URL(doc.authorization_endpoint);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: clientIdOf(provider),
    redirect_uri: callbackUrl(provider),
    state: flow.state,
    nonce: flow.nonce,
  };
  if (provider === "google") {
    Object.assign(params, {
      scope: "openid email profile",
      code_challenge: s256(flow.codeVerifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    if (env.googleHostedDomain) params.hd = env.googleHostedDomain;
  } else {
    // Asking for the name and email makes Apple post the answer back (form_post).
    Object.assign(params, { scope: "name email", response_mode: "form_post" });
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), flowId: flow.id };
}

/** Apple's cross-site POST: park the code with its flow until the browser comes back with its cookie. */
export function parkAppleResult(state: string, code: string, userJson: string | null) {
  const flow = getDb().select().from(schema.oauthFlows).where(eq(schema.oauthFlows.state, state)).get();
  if (!flow || flow.provider !== "apple" || flow.code) return false;
  getDb()
    .update(schema.oauthFlows)
    .set({ code, userJson: userJson?.slice(0, 2000) ?? null })
    .where(eq(schema.oauthFlows.id, flow.id))
    .run();
  return true;
}

function sameSecret(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Finishes a sign-in: checks the state against this browser's flow cookie,
 * swaps the code for an id_token and verifies it. The flow can be used once.
 */
export async function finishSignIn(
  provider: Provider,
  { state, code, flowId }: { state: string; code?: string | null; flowId: string | undefined },
  now = Date.now(),
) {
  const db = getDb();
  const flow = state ? db.select().from(schema.oauthFlows).where(eq(schema.oauthFlows.state, state)).get() : undefined;
  if (!flow || flow.provider !== provider || !flowId || !sameSecret(flow.id, flowId)) {
    throw new SignInError("expired", "This sign-in didn't start in this browser, or took too long. Please try again.");
  }
  db.delete(schema.oauthFlows).where(eq(schema.oauthFlows.id, flow.id)).run();
  if (flow.expiresAt.getTime() < now) throw new SignInError("expired", "The sign-in took too long. Please try again.");
  const theCode = code ?? flow.code;
  if (!theCode) throw new SignInError("failed", "The provider didn't send a sign-in code");

  const { doc, jwks } = await discover(provider);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: theCode,
    redirect_uri: callbackUrl(provider),
    client_id: clientIdOf(provider),
    client_secret: provider === "google" ? env.googleClientSecret : await appleClientSecret(),
  });
  if (provider === "google") body.set("code_verifier", flow.codeVerifier);
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !tokens.id_token) {
    throw new SignInError("failed", `Sign-in was refused: ${tokens.error_description || tokens.error || res.status}`);
  }
  const claims = await verifyIdToken(tokens.id_token, {
    issuer: provider === "google" ? [doc.issuer, "accounts.google.com"] : doc.issuer,
    audience: clientIdOf(provider),
    nonce: flow.nonce,
    jwks,
    hostedDomain: provider === "google" ? env.googleHostedDomain : "",
  });
  return { ...claims, name: claims.name ?? appleName(flow.userJson) };
}

// ------------------------------------------------------------------ id_token

export type VerifiedIdentity = { email: string; name: string | null; privateRelay: boolean };

/** Checks an id_token's signature and claims, and returns the verified email address. */
export async function verifyIdToken(
  idToken: string,
  opts: { issuer: string | string[]; audience: string; nonce: string; jwks: JWTVerifyGetKey; hostedDomain?: string },
): Promise<VerifiedIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, opts.jwks, {
      issuer: opts.issuer,
      audience: opts.audience,
      algorithms: ["RS256"],
      clockTolerance: 60,
    }));
  } catch (err) {
    throw new SignInError("failed", `The sign-in token didn't check out (${(err as Error).message})`);
  }
  if (typeof payload.nonce !== "string" || !sameSecret(payload.nonce, opts.nonce)) {
    throw new SignInError("failed", "The sign-in token was for a different sign-in");
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  // Apple sends "true" as a string.
  const verified = payload.email_verified === true || payload.email_verified === "true";
  if (!email || !verified) throw new SignInError("unverified", "That account's email address isn't verified");
  if (opts.hostedDomain && payload.hd !== opts.hostedDomain) {
    throw new SignInError("wrong-domain", `Use a ${opts.hostedDomain} Google account`);
  }
  const privateRelay = payload.is_private_email === true || payload.is_private_email === "true" || email.endsWith("@privaterelay.appleid.com");
  return { email, name: typeof payload.name === "string" ? payload.name : null, privateRelay };
}

/** Apple sends the person's name once, on their first sign-in, in a separate `user` field. */
function appleName(userJson: string | null) {
  if (!userJson) return null;
  try {
    const { name } = JSON.parse(userJson) as { name?: { firstName?: string; lastName?: string } };
    const full = [name?.firstName, name?.lastName].filter(Boolean).join(" ").trim();
    return full ? full.slice(0, 120) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Apple's client secret

let appleSecret: { key: string; value: string; until: number } | null = null;

/** Apple's client secret is a short-lived ES256 JWT signed with the .p8 key. Cached and renewed. */
export async function appleClientSecret(now = Date.now()) {
  const key = [env.appleTeamId, env.appleClientId, env.appleKeyId, env.appleIssuer, env.applePrivateKey].join("|");
  if (appleSecret && appleSecret.key === key && appleSecret.until > now) return appleSecret.value;
  let privateKey;
  try {
    privateKey = await importPKCS8(env.applePrivateKey, "ES256");
  } catch {
    throw new SignInError("not-configured", "APPLE_PRIVATE_KEY isn't a valid .p8 key");
  }
  const iat = Math.floor(now / 1000);
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.appleKeyId })
    .setIssuer(env.appleTeamId)
    .setSubject(env.appleClientId)
    .setAudience(env.appleIssuer.replace(/\/+$/, ""))
    .setIssuedAt(iat)
    .setExpirationTime(iat + 60 * 60)
    .sign(privateKey);
  appleSecret = { key, value, until: now + 50 * 60 * 1000 };
  return value;
}

export function flowCookieHeader(flowId: string, secure: boolean) {
  return `${FLOW_COOKIE}=${flowId}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${FLOW_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
}

export function clearFlowCookieHeader() {
  return `${FLOW_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
}
