import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { getDb, schema } from "@/db";
import { env } from "./env";

/**
 * Sign in with Google, Apple or any OpenID Connect provider (TEAM-03: Okta,
 * Microsoft Entra ID, Authentik, Keycloak…), with the authorization code
 * flow. Each sign-in gets a random state, nonce and (for Google and generic
 * OIDC) PKCE verifier, kept server-side for 10 minutes and tied to the
 * browser by a cookie. The id_token is checked against the provider's
 * published keys: issuer, audience, expiry, nonce and a verified email
 * address. Who may then sign in is decided as for every method (roleFor).
 */

export type Provider = "google" | "apple" | "oidc";
export const PROVIDERS: Provider[] = ["google", "apple", "oidc"];
export const FLOW_COOKIE = "plaudit_oauth";
const FLOW_TTL_MS = 10 * 60 * 1000;

export class SignInError extends Error {
  constructor(
    /** Shown on the sign-in page as ?error=… */
    readonly reason: "not-configured" | "expired" | "failed" | "unverified" | "wrong-domain" | "sso-domain" | "cancelled",
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
      : provider === "apple"
        ? [
            ["APPLE_CLIENT_ID", env.appleClientId],
            ["APPLE_TEAM_ID", env.appleTeamId],
            ["APPLE_KEY_ID", env.appleKeyId],
            ["APPLE_PRIVATE_KEY", env.applePrivateKey],
          ]
        : [
            ["OIDC_ISSUER", env.oidcIssuer],
            ["OIDC_CLIENT_ID", env.oidcClientId],
            ["OIDC_CLIENT_SECRET", env.oidcClientSecret],
          ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  return { enabled: missing.length === 0, missing, partly: missing.length > 0 && missing.length < required.length };
}

export const callbackUrl = (provider: Provider) => `${env.publicUrl}/api/auth/callback/${provider}`;
const issuerOf = (provider: Provider) =>
  (provider === "google" ? env.googleIssuer : provider === "apple" ? env.appleIssuer : env.oidcIssuer).replace(/\/+$/, "");
const clientIdOf = (provider: Provider) => (provider === "google" ? env.googleClientId : provider === "apple" ? env.appleClientId : env.oidcClientId);
/** How the provider is named in messages and on the sign-in button. */
export const providerLabel = (provider: Provider) => (provider === "google" ? "Google" : provider === "apple" ? "Apple" : env.oidcLabel);

// ------------------------------------------------------------------ discovery

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
};
const discoveries = new Map<string, { at: number; doc: Discovery; jwks: JWTVerifyGetKey }>();

/** Signature algorithms we accept from a generic provider: public-key ones only, never HS256 (that would key on the client secret). */
const ASYMMETRIC = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

/** The endpoint URLs a discovery document gives must be http(s); anything else is refused. */
const httpUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

async function discover(provider: Provider) {
  const issuer = issuerOf(provider);
  const cached = discoveries.get(issuer);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
  if (!res?.ok) throw new SignInError("failed", `Couldn't reach ${providerLabel(provider)} (${res?.status ?? "no answer"})`);
  const doc = (await res.json().catch(() => null)) as Discovery | null;
  if (!doc || !httpUrl(doc.authorization_endpoint) || !httpUrl(doc.token_endpoint) || !httpUrl(doc.jwks_uri) || typeof doc.issuer !== "string") {
    throw new SignInError("failed", `${providerLabel(provider)}'s discovery document is incomplete`);
  }
  // OpenID Connect Discovery §4.3: the document must name the issuer it was fetched for.
  if (provider === "oidc" && doc.issuer.replace(/\/+$/, "") !== issuer) {
    throw new SignInError("failed", `The discovery document names another issuer (${doc.issuer}); check OIDC_ISSUER`);
  }
  const entry = { at: Date.now(), doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  discoveries.set(issuer, entry);
  return entry;
}

/** Algorithms to accept in a generic provider's id_token: what it says it uses, public-key only; RS256 if it doesn't say. */
function oidcAlgorithms(doc: Discovery) {
  const listed = (doc.id_token_signing_alg_values_supported ?? []).filter((a) => ASYMMETRIC.includes(a));
  return listed.length ? listed : ["RS256"];
}

/** client_secret_basic is the spec's default; client_secret_post only when the provider offers just that. */
function oidcClientAuth(doc: Discovery): "basic" | "post" {
  const m = doc.token_endpoint_auth_methods_supported;
  return m && !m.includes("client_secret_basic") && m.includes("client_secret_post") ? "post" : "basic";
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
  } else if (provider === "oidc") {
    Object.assign(params, { scope: env.oidcScopes, code_challenge: s256(flow.codeVerifier), code_challenge_method: "S256" });
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
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (provider === "oidc" && oidcClientAuth(doc) === "basic") {
    // RFC 6749 §2.3.1: both parts form-encoded before they're joined.
    const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, "+");
    headers.Authorization = `Basic ${Buffer.from(`${enc(env.oidcClientId)}:${enc(env.oidcClientSecret)}`).toString("base64")}`;
  } else {
    body.set("client_secret", provider === "google" ? env.googleClientSecret : provider === "oidc" ? env.oidcClientSecret : await appleClientSecret());
  }
  if (provider !== "apple") body.set("code_verifier", flow.codeVerifier);
  const res = await fetch(doc.token_endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000), redirect: "error" });
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
    ...(provider === "oidc"
      ? { algorithms: oidcAlgorithms(doc), trustEmail: env.oidcTrustEmail, emailDomains: env.oidcEmailDomains }
      : {}),
  });
  return { ...claims, name: claims.name ?? appleName(flow.userJson) };
}

// ------------------------------------------------------------------ id_token

export type VerifiedIdentity = { email: string; name: string | null; privateRelay: boolean };

/**
 * Checks an id_token's signature and claims, and returns the verified email
 * address. `trustEmail` accepts an address without email_verified (generic
 * OIDC only, OIDC_TRUST_EMAIL); `emailDomains` limits which addresses that
 * provider may vouch for.
 */
export async function verifyIdToken(
  idToken: string,
  opts: {
    issuer: string | string[];
    audience: string;
    nonce: string;
    jwks: JWTVerifyGetKey;
    hostedDomain?: string;
    algorithms?: string[];
    trustEmail?: boolean;
    emailDomains?: string[];
  },
): Promise<VerifiedIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, opts.jwks, {
      issuer: opts.issuer,
      audience: opts.audience,
      algorithms: opts.algorithms ?? ["RS256"],
      clockTolerance: 60,
    }));
  } catch (err) {
    throw new SignInError("failed", `The sign-in token didn't check out (${(err as Error).message})`);
  }
  if (typeof payload.nonce !== "string" || !sameSecret(payload.nonce, opts.nonce)) {
    throw new SignInError("failed", "The sign-in token was for a different sign-in");
  }
  // OpenID Connect Core §3.1.3.7: a token for several audiences must name us as the authorized party.
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== opts.audience) {
    throw new SignInError("failed", "The sign-in token was issued to another app");
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  // Apple sends "true" as a string.
  const verified = payload.email_verified === true || payload.email_verified === "true";
  // Trusting the provider never covers an address it says outright is unverified.
  const trusted = Boolean(opts.trustEmail) && payload.email_verified !== false && payload.email_verified !== "false";
  if (!email || !(verified || trusted)) throw new SignInError("unverified", "That account's email address isn't verified");
  if (opts.hostedDomain && payload.hd !== opts.hostedDomain) {
    throw new SignInError("wrong-domain", `Use a ${opts.hostedDomain} Google account`);
  }
  if (opts.emailDomains?.length && !opts.emailDomains.includes(email.slice(email.lastIndexOf("@") + 1))) {
    throw new SignInError("sso-domain", "That address isn't at one of the domains this sign-in accepts");
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
