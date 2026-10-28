import crypto from "node:crypto";
import { and, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { OAuthScope } from "@/db/schema";
import { canOpen, projectAccessFor, roleAtLeast } from "./access";
import { audit, memberActor, type Actor } from "./audit";
import { env } from "./env";
import { registerPeriodic } from "./jobs";
import type { Principal } from "./mcp";
import { roleFor } from "./members";
import { rateLimit } from "./rate-limit";

const { oauthClients, oauthGrants, oauthGrantProjects, oauthCodes, oauthTokens } = schema;

/**
 * OAuth 2.1 for the MCP server (INT-04, flag `mcp`), so connectors such as
 * Claude.ai's and ChatGPT's can connect without pasting a key:
 * protected-resource metadata (RFC 9728), authorization-server metadata
 * (RFC 8414), dynamic registration of public clients (RFC 7591), the
 * authorization code flow with PKCE S256 only, and revocation (RFC 7009).
 * A signed-in member approves on a consent page; tokens act with that
 * member's role and projects, within the scope and projects they chose.
 * Codes and tokens are stored as SHA-256 hashes. Access tokens last an hour;
 * refresh tokens 30 days and rotate on every use (using one twice revokes
 * the whole grant, as a stolen token would be).
 */

export const SCOPES = { read: "plaudit:read", write: "plaudit:write" } as const;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_CLIENTS = 500;

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const random = (prefix: string) => `${prefix}${crypto.randomBytes(32).toString("base64url")}`;

/** Carries an authorization request through sign-in, back to the consent page (Path=/admin, 10 minutes). */
export const RESUME_COOKIE = "plaudit_oauth_resume";

export const issuer = () => env.publicUrl;
export const mcpResource = () => `${env.publicUrl}/mcp`;
export const resourceMetadataUrl = () => `${env.publicUrl}/.well-known/oauth-protected-resource/mcp`;

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const oauthJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", "Access-Control-Allow-Origin": "*" } });
export const oauthFail = (e: OAuthError) => oauthJson({ error: e.code, error_description: e.message }, e.status);

/** RFC 9728: what /mcp is and who issues its tokens. */
export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: Object.values(SCOPES),
    bearer_methods_supported: ["header"],
    resource_name: "Plaudit",
  };
}

/** RFC 8414. */
export function authServerMetadata() {
  const base = issuer();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: Object.values(SCOPES),
  };
}

// ------------------------------------------------------------------ registration (RFC 7591)

/** https anywhere; http only to this computer (desktop apps listen on localhost). No fragments, no credentials. */
export function validRedirectUri(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password || raw.length > 500) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

const registration = z.object({
  redirect_uris: z.array(z.string()).min(1).max(5),
  client_name: z.string().trim().max(100).optional(),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).max(5).optional(),
  response_types: z.array(z.string()).max(5).optional(),
});

export function registerClient(input: unknown, ipKey: string) {
  if (!rateLimit(`oauth-register:${ipKey}`, 20, 60 * 60 * 1000)) throw new OAuthError("too_many_requests", "Too many registrations from here; try again later", 429);
  const parsed = registration.safeParse(input);
  if (!parsed.success) throw new OAuthError("invalid_client_metadata", "Send redirect_uris (1 to 5) and optionally client_name");
  const d = parsed.data;
  if (d.token_endpoint_auth_method && d.token_endpoint_auth_method !== "none") {
    throw new OAuthError("invalid_client_metadata", "Only public clients are supported (token_endpoint_auth_method: none)");
  }
  if (d.grant_types?.some((g) => g !== "authorization_code" && g !== "refresh_token")) throw new OAuthError("invalid_client_metadata", "Only authorization_code and refresh_token");
  if (d.response_types?.some((r) => r !== "code")) throw new OAuthError("invalid_client_metadata", "Only the code response type");
  const bad = d.redirect_uris.find((u) => !validRedirectUri(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", "Redirect URIs must be https://, or http:// to localhost or 127.0.0.1, without a #fragment");
  const db = getDb();
  if ((db.select({ n: count() }).from(oauthClients).get()?.n ?? 0) >= MAX_CLIENTS) {
    // Make room: clients that were never used for a day are dropped first.
    db.delete(oauthClients)
      .where(and(isNull(oauthClients.lastUsedAt), lt(oauthClients.createdAt, new Date(Date.now() - 86_400_000))))
      .run();
    if ((db.select({ n: count() }).from(oauthClients).get()?.n ?? 0) >= MAX_CLIENTS) throw new OAuthError("invalid_client_metadata", "Too many clients are registered on this server", 400);
  }
  const row = db
    .insert(oauthClients)
    .values({ id: random("mcpc_").slice(0, 40), name: d.client_name || "An MCP client", redirectUris: JSON.stringify([...new Set(d.redirect_uris)]), createdAt: new Date() })
    .returning()
    .get();
  return {
    client_id: row.id,
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    client_name: row.name,
    redirect_uris: JSON.parse(row.redirectUris) as string[],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function getClient(id: string) {
  const row = id ? (getDb().select().from(oauthClients).where(eq(oauthClients.id, id)).get() ?? null) : null;
  return row ? { ...row, redirect: JSON.parse(row.redirectUris) as string[] } : null;
}

// ------------------------------------------------------------------ authorization

export type AuthRequest = { clientId: string; redirectUri: string; state: string | null; codeChallenge: string; scope: OAuthScope; exp: number };

/**
 * Checks an authorization request. Problems with the client or its redirect
 * URI are shown on our own page (never redirected to an address we can't
 * trust); the rest go back to the client's redirect URI with `state`.
 */
export function parseAuthorize(q: URLSearchParams): { ok: AuthRequest } | { page: string } | { redirect: string } {
  const client = getClient(q.get("client_id") ?? "");
  if (!client) return { page: "This app isn't registered with this Plaudit server. Try connecting again from the app." };
  const asked = q.get("redirect_uri");
  const redirectUri = asked ?? (client.redirect.length === 1 ? client.redirect[0] : "");
  if (!redirectUri || !client.redirect.includes(redirectUri)) return { page: "This app asked to return to an address it didn't register, so Plaudit stopped here." };
  const state = q.get("state");
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (state) u.searchParams.set("state", state);
    u.searchParams.set("iss", issuer());
    return { redirect: u.toString() };
  };
  if (q.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code");
  const challenge = q.get("code_challenge") ?? "";
  if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  const resource = q.get("resource");
  if (resource && resource.replace(/\/+$/, "") !== mcpResource()) return back("invalid_target", "This server issues tokens for its /mcp resource only");
  const scopes = (q.get("scope") ?? SCOPES.read).split(/\s+/).filter(Boolean);
  if (scopes.some((s) => s !== SCOPES.read && s !== SCOPES.write)) return back("invalid_scope", `Use ${SCOPES.read} or ${SCOPES.write}`);
  return { ok: { clientId: client.id, redirectUri, state: state ? state.slice(0, 500) : null, codeChallenge: challenge, scope: scopes.includes(SCOPES.write) ? "write" : "read", exp: Date.now() + REQUEST_TTL_MS } };
}

/** The checked request, carried to the consent page and back signed (so it can't be altered on the way). */
export function signRequest(r: AuthRequest) {
  const body = Buffer.from(JSON.stringify(r)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", env.sessionSecret).update(`oauth:${body}`).digest("base64url")}`;
}

export function verifyRequest(token: string | null | undefined): AuthRequest | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", env.sessionSecret).update(`oauth:${body}`).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const r = JSON.parse(Buffer.from(body, "base64url").toString()) as AuthRequest;
    return r.exp > Date.now() ? r : null;
  } catch {
    return null;
  }
}

/** The member said yes: a single-use code, sent back to the client's redirect URI. */
export function approve(r: AuthRequest, email: string, choice: { scope: OAuthScope; projectIds: string[] | null }) {
  const role = roleFor(email);
  if (!role) throw new OAuthError("access_denied", "You can't sign in here any more", 403);
  // Write access is for those who may change content (editors and up).
  const scope: OAuthScope = choice.scope === "write" && r.scope === "write" && roleAtLeast(role, "editor") ? "write" : "read";
  const access = projectAccessFor(email, role);
  const projectIds = choice.projectIds === null ? (access.all ? null : [...access.ids]) : choice.projectIds.filter((id) => canOpen(access, id));
  const code = random("pac_");
  getDb()
    .insert(oauthCodes)
    .values({
      id: crypto.randomUUID(),
      codeHash: sha256(code),
      clientId: r.clientId,
      memberEmail: email,
      scope,
      projectIds: projectIds === null ? null : JSON.stringify(projectIds),
      redirectUri: r.redirectUri,
      codeChallenge: r.codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      createdAt: new Date(),
    })
    .run();
  const u = new URL(r.redirectUri);
  u.searchParams.set("code", code);
  if (r.state) u.searchParams.set("state", r.state);
  u.searchParams.set("iss", issuer());
  return u.toString();
}

/** The member said no. */
export function deny(r: AuthRequest) {
  const u = new URL(r.redirectUri);
  u.searchParams.set("error", "access_denied");
  if (r.state) u.searchParams.set("state", r.state);
  u.searchParams.set("iss", issuer());
  return u.toString();
}

// ------------------------------------------------------------------ tokens

function issue(grantId: string, scope: OAuthScope) {
  const access = random("plo_");
  const refresh = random("plr_");
  const now = Date.now();
  getDb()
    .insert(oauthTokens)
    .values([
      { id: crypto.randomUUID(), tokenHash: sha256(access), grantId, kind: "access", expiresAt: new Date(now + ACCESS_TTL_S * 1000), createdAt: new Date(now) },
      { id: crypto.randomUUID(), tokenHash: sha256(refresh), grantId, kind: "refresh", expiresAt: new Date(now + REFRESH_TTL_MS), createdAt: new Date(now) },
    ])
    .run();
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scope === "write" ? `${SCOPES.read} ${SCOPES.write}` : SCOPES.read };
}

const grantActor = (g: { id: string; memberEmail: string }, clientName: string): Actor => ({ type: "oauth", id: g.id, label: `${clientName} for ${g.memberEmail}` });

/** grant_type=authorization_code: the code, once, from the same client and redirect URI, with the PKCE verifier. */
export function exchangeCode(p: { code?: string | null; clientId?: string | null; redirectUri?: string | null; verifier?: string | null }) {
  const db = getDb();
  const row = p.code ? db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, sha256(p.code))).get() : undefined;
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "The code is unknown, used or expired");
  db.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.id, row.id)).run();
  if (row.clientId !== p.clientId) throw new OAuthError("invalid_grant", "The code was issued to another client");
  if (row.redirectUri !== p.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request");
  const challenge = crypto.createHash("sha256").update(p.verifier ?? "").digest("base64url");
  if (!p.verifier || challenge !== row.codeChallenge) throw new OAuthError("invalid_grant", "The PKCE code_verifier doesn't match");
  if (!roleFor(row.memberEmail)) throw new OAuthError("invalid_grant", "The member who approved this can't sign in any more");
  const client = getClient(row.clientId)!;
  const projectIds = row.projectIds ? (JSON.parse(row.projectIds) as string[]) : null;
  const grant = db.transaction((tx) => {
    const g = tx
      .insert(oauthGrants)
      .values({ id: crypto.randomUUID(), clientId: row.clientId, memberEmail: row.memberEmail, scope: row.scope, allProjects: projectIds === null, createdAt: new Date() })
      .returning()
      .get();
    const valid = projectIds?.length ? tx.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.id, projectIds)).all() : [];
    for (const v of valid) tx.insert(oauthGrantProjects).values({ grantId: g.id, projectId: v.id }).run();
    tx.update(oauthClients).set({ lastUsedAt: new Date() }).where(eq(oauthClients.id, row.clientId)).run();
    return g;
  });
  audit(memberActor(row.memberEmail), "oauth.grant", { objectType: "oauth_grant", objectId: grant.id, summary: client.name, meta: { scope: grant.scope, projectIds: projectIds ?? "all" } });
  return issue(grant.id, grant.scope);
}

function revokeGrantRow(grantId: string, actor: Actor | null, why: string) {
  const db = getDb();
  const g = db.update(oauthGrants).set({ revokedAt: new Date() }).where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt))).returning().get();
  db.delete(oauthTokens).where(eq(oauthTokens.grantId, grantId)).run();
  if (g) {
    const client = getClient(g.clientId);
    audit(actor ?? grantActor(g, client?.name ?? "An MCP client"), "oauth.revoke", { objectType: "oauth_grant", objectId: g.id, summary: client?.name ?? "", meta: { why } });
  }
  return g ?? null;
}

/** grant_type=refresh_token: a new pair; the old refresh token stops working. Using it again revokes the grant. */
export function refreshTokens(p: { refreshToken?: string | null; clientId?: string | null }) {
  const db = getDb();
  const row = p.refreshToken ? db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, sha256(p.refreshToken))).get() : undefined;
  if (!row || row.kind !== "refresh") throw new OAuthError("invalid_grant", "Unknown refresh token");
  const grant = db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).get();
  if (!grant || grant.revokedAt) throw new OAuthError("invalid_grant", "This connection was revoked");
  if (row.usedAt) {
    revokeGrantRow(grant.id, null, "a refresh token was used twice");
    throw new OAuthError("invalid_grant", "This refresh token was already used, so the connection was revoked");
  }
  if (row.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "The refresh token expired; connect again");
  if (grant.clientId !== p.clientId) throw new OAuthError("invalid_grant", "The token was issued to another client");
  if (!roleFor(grant.memberEmail)) {
    revokeGrantRow(grant.id, null, "the member can't sign in any more");
    throw new OAuthError("invalid_grant", "The member who connected this can't sign in any more");
  }
  db.update(oauthTokens).set({ usedAt: new Date() }).where(eq(oauthTokens.id, row.id)).run();
  db.delete(oauthTokens).where(and(eq(oauthTokens.grantId, grant.id), eq(oauthTokens.kind, "access"))).run();
  return issue(grant.id, grant.scope);
}

/** RFC 7009: always "OK"; a refresh token ends the whole connection, an access token just itself. */
export function revokeToken(token: string | null | undefined) {
  if (!token) return;
  const db = getDb();
  const row = db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, sha256(token))).get();
  if (!row) return;
  if (row.kind === "refresh") revokeGrantRow(row.grantId, null, "revoked by the app");
  else db.delete(oauthTokens).where(eq(oauthTokens.id, row.id)).run();
}

/** The caller behind an MCP access token, or null. Its scope and projects follow the member's role and access now, not when they connected. */
export function oauthPrincipal(token: string): Principal | null {
  const db = getDb();
  const row = db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, sha256(token))).get();
  if (!row || row.kind !== "access" || row.expiresAt.getTime() < Date.now()) return null;
  const grant = db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).get();
  if (!grant || grant.revokedAt) return null;
  const role = roleFor(grant.memberEmail);
  if (!role) return null;
  const access = projectAccessFor(grant.memberEmail, role);
  const chosen = grant.allProjects ? null : new Set(db.select().from(oauthGrantProjects).where(eq(oauthGrantProjects.grantId, grant.id)).all().map((r) => r.projectId));
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > 60_000) db.update(oauthGrants).set({ lastUsedAt: new Date() }).where(eq(oauthGrants.id, grant.id)).run();
  return {
    id: grant.id,
    label: grant.memberEmail,
    scope: grant.scope === "write" && roleAtLeast(role, "editor") ? "write" : "read",
    canAccess: (projectId) => canOpen(access, projectId) && (!chosen || chosen.has(projectId)),
  };
}

// ------------------------------------------------------------------ Settings › API keys

export function listGrants() {
  const db = getDb();
  const rows = db
    .select({ g: oauthGrants, clientName: oauthClients.name })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(isNull(oauthGrants.revokedAt))
    .orderBy(desc(oauthGrants.createdAt))
    .all();
  const links = db.select().from(oauthGrantProjects).all();
  return rows.map(({ g, clientName }) => ({
    id: g.id,
    clientName,
    memberEmail: g.memberEmail,
    scope: g.scope,
    projectIds: g.allProjects ? null : links.filter((l) => l.grantId === g.id).map((l) => l.projectId),
    createdAt: g.createdAt.toISOString(),
    lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
  }));
}

export function revokeGrant(id: string, by: Actor) {
  return revokeGrantRow(id, by, "revoked in Settings");
}

/** Hourly: expired codes and tokens, and connections revoked a month ago. */
export function cleanupOAuth(now = Date.now()) {
  const db = getDb();
  db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, new Date(now))).run();
  db.delete(oauthTokens).where(or(lt(oauthTokens.expiresAt, new Date(now)))).run();
  db.delete(oauthGrants).where(lt(oauthGrants.revokedAt, new Date(now - REFRESH_TTL_MS))).run();
}

export function registerOAuthJobs() {
  registerPeriodic("oauth.cleanup", 60 * 60 * 1000, () => cleanupOAuth());
}
