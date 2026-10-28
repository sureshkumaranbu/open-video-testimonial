import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as asMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as prMetadata } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { POST as consent } from "@/app/api/admin/oauth/authorize/route";
import { GET as grantsRoute } from "@/app/api/admin/oauth-grants/route";
import { DELETE as revokeGrantRoute } from "@/app/api/admin/oauth-grants/[id]/route";
import { DELETE as removeMember } from "@/app/api/admin/team/[id]/route";
import { POST as teamInvite } from "@/app/api/admin/team/route";
import { POST as register } from "@/app/api/oauth/register/route";
import { POST as revoke } from "@/app/api/oauth/revoke/route";
import { POST as token } from "@/app/api/oauth/token/route";
import { POST as mcpPost } from "@/app/mcp/route";
import { GET as authorize } from "@/app/oauth/authorize/route";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { listAudit } from "@/lib/audit";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { adminHeaders, ADMIN_EMAIL, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let a: { id: string };
let b: { id: string };
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

beforeEach(() => {
  ctx = useTempDataDir();
  a = createProject({ name: "Alpha", slug: "alpha" });
  b = createProject({ name: "Beta", slug: "beta" });
  for (const [p, name] of [[a, "Ada"], [b, "Bo"]] as const) {
    const t = createTestimonial(p.id, { name, text: `${name} likes it` }, { source: "api" });
    updateTestimonial(t.id, { status: "approved" }, { actor: "api" });
  }
});
afterEach(() => {
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

const cookieFor = (email: string) => (email === ADMIN_EMAIL ? adminHeaders().cookie : `${sessionCookieName()}=${createSessionToken(email)}`);
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const form = (url: string, fields: Record<string, string>) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", body: new URLSearchParams(fields), headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.9" } });

async function newClient(redirect_uris = [REDIRECT]) {
  const res = await register(json("/api/oauth/register", { client_name: "Claude", redirect_uris }, { "x-forwarded-for": "198.51.100.9" }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()).client_id as string;
}

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
};

/** The whole dance as `email`: authorize, consent, then the code for tokens. */
async function connect(email: string, o: { scope?: string; choose?: "read" | "write"; projectIds?: string[] | null } = {}) {
  const clientId = await newClient();
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s-123", scope: o.scope ?? "plaudit:read plaudit:write", resource: "http://localhost:3000/mcp" });
  const started = await authorize(new Request(`http://localhost:3000/oauth/authorize?${q}`, { headers: { cookie: cookieFor(email) } }));
  expect(started.status).toBe(302);
  const consentUrl = new URL(started.headers.get("location")!);
  expect(consentUrl.pathname).toBe("/admin/oauth");
  const answer = await consent(
    json("/api/admin/oauth/authorize", { req: consentUrl.searchParams.get("req"), decision: "allow", scope: o.choose ?? "write", projectIds: o.projectIds ?? null }, { cookie: cookieFor(email), "sec-fetch-site": "same-origin" }),
  );
  expect(answer.status, await answer.clone().text()).toBe(200);
  const back = new URL((await answer.json()).redirect);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe("s-123");
  const code = back.searchParams.get("code")!;
  const res = await token(form("/api/oauth/token", { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }));
  expect(res.status, await res.clone().text()).toBe(200);
  return { clientId, code, verifier, tokens: (await res.json()) as { access_token: string; refresh_token: string; scope: string; expires_in: number } };
}

async function mcp(accessToken: string, method: string, p?: unknown) {
  const res = await mcpPost(json("/mcp", { jsonrpc: "2.0", id: 1, method, ...(p ? { params: p } : {}) }, { authorization: `Bearer ${accessToken}` }));
  return { status: res.status, body: res.status === 200 ? await res.json() : null, res };
}

describe("INT-04 OAuth for the MCP server", () => {
  it("INT-04 publishes protected-resource and authorization-server metadata, and a 401 points at it", async () => {
    expect(await (await prMetadata()).json()).toEqual({
      resource: "http://localhost:3000/mcp",
      authorization_servers: ["http://localhost:3000"],
      scopes_supported: ["plaudit:read", "plaudit:write"],
      bearer_methods_supported: ["header"],
      resource_name: "Plaudit",
    });
    expect(await (await asMetadata()).json()).toMatchObject({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/oauth/authorize",
      token_endpoint: "http://localhost:3000/api/oauth/token",
      registration_endpoint: "http://localhost:3000/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    const res = await mcpPost(json("/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="plaudit", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"');
    process.env.PLAUDIT_FEATURES = "forms";
    expect((await asMetadata()).status).toBe(404);
  });

  it("INT-04 registers public clients with https or localhost redirect URIs only, rate-limited", async () => {
    expect(await newClient(["https://chatgpt.com/connector/oauth/abc", "http://127.0.0.1:33418/callback", "http://localhost:6274/cb"])).toMatch(/^mcpc_/);
    for (const bad of ["http://evil.example/cb", "https://ok.example/cb#frag", "javascript:alert(1)", "cursor://anysphere/cb"]) {
      const res = await register(json("/api/oauth/register", { redirect_uris: [bad] }));
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error).toBe("invalid_redirect_uri");
    }
    expect((await (await register(json("/api/oauth/register", { redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" }))).json()).error).toBe("invalid_client_metadata");
    let last = 201;
    for (let i = 0; i < 25; i++) last = (await register(json("/api/oauth/register", { redirect_uris: [REDIRECT] }, { "x-forwarded-for": "203.0.113.50" }))).status;
    expect(last).toBe(429);
  });

  it("INT-04 the authorize endpoint never redirects to an address the client didn't register, and sends the rest back with state", async () => {
    const clientId = await newClient();
    const { challenge } = pkce();
    const go = (q: Record<string, string>, cookie = cookieFor(ADMIN_EMAIL)) => authorize(new Request(`http://localhost:3000/oauth/authorize?${new URLSearchParams(q)}`, { headers: { cookie } }));
    const base = { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" };
    const unknown = await go({ ...base, client_id: "mcpc_nope" });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("location")).toBeNull();
    const elsewhere = await go({ ...base, redirect_uri: "https://evil.example/cb" });
    expect(elsewhere.status).toBe(400);
    expect(await elsewhere.text()).toContain("didn&#39;t register");
    const noPkce = await go({ ...base, code_challenge_method: "plain" });
    const back = new URL(noPkce.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(Object.fromEntries(back.searchParams)).toMatchObject({ error: "invalid_request", state: "xyz" });
    expect(new URL((await go({ ...base, resource: "https://other.example/mcp" })).headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
    // Not signed in: to the sign-in page, with the request kept in a cookie for the consent page.
    const anon = await go(base, "");
    expect(anon.headers.get("location")).toBe("http://localhost:3000/admin/login");
    expect(anon.headers.get("set-cookie")).toMatch(/^plaudit_oauth_resume=[^;]+; Path=\/admin; HttpOnly; SameSite=Lax; Max-Age=600/);
  });

  it("INT-04 code with PKCE for tokens, once; the token reaches only the chosen projects, with the member's role", async () => {
    const { clientId, code, verifier, tokens } = await connect(ADMIN_EMAIL, { projectIds: [a.id] });
    expect(tokens).toMatchObject({ access_token: expect.stringMatching(/^plo_/), refresh_token: expect.stringMatching(/^plr_/), expires_in: 3600, scope: "plaudit:read plaudit:write" });
    // The same code twice, or with another verifier, is refused.
    expect((await (await token(form("/api/oauth/token", { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }))).json()).error).toBe("invalid_grant");

    const tools = (await mcp(tokens.access_token, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("create_invite");
    const list = await mcp(tokens.access_token, "tools/call", { name: "list_testimonials", arguments: {} });
    expect(list.body.result.structuredContent.project.slug).toBe("alpha");
    expect((await mcp(tokens.access_token, "tools/call", { name: "summarize", arguments: { project: "beta" } })).body.result.isError).toBe(true);
    expect(listAudit({ action: "oauth.grant" }, { limit: 5, offset: 0 }).rows[0]).toMatchObject({ actorLabel: ADMIN_EMAIL, summary: "Claude" });
  });

  it("INT-04 a wrong PKCE verifier or redirect URI gets no tokens", async () => {
    const clientId = await newClient();
    const { challenge } = pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" });
    const consentUrl = new URL((await authorize(new Request(`http://localhost:3000/oauth/authorize?${q}`, { headers: { cookie: cookieFor(ADMIN_EMAIL) } }))).headers.get("location")!);
    const ans = await consent(json("/api/admin/oauth/authorize", { req: consentUrl.searchParams.get("req"), decision: "allow" }, { cookie: cookieFor(ADMIN_EMAIL), "sec-fetch-site": "same-origin" }));
    const code = new URL((await ans.json()).redirect).searchParams.get("code")!;
    const res = await token(form("/api/oauth/token", { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: "x".repeat(43) }));
    expect(await res.json()).toMatchObject({ error: "invalid_grant", error_description: expect.stringMatching(/PKCE/) });
    // A tampered consent request is refused.
    const tampered = await consent(json("/api/admin/oauth/authorize", { req: `${consentUrl.searchParams.get("req")}x`, decision: "allow" }, { cookie: cookieFor(ADMIN_EMAIL), "sec-fetch-site": "same-origin" }));
    expect(tampered.status).toBe(400);
  });

  it("INT-04 a viewer can only grant read, whatever was asked", async () => {
    await teamInvite(json("/api/admin/team", { email: "vi@example.com", role: "viewer", projectIds: [b.id] }, { cookie: cookieFor(ADMIN_EMAIL), "sec-fetch-site": "same-origin" }));
    const { tokens } = await connect("vi@example.com", { choose: "write" });
    expect(tokens.scope).toBe("plaudit:read");
    const tools = (await mcp(tokens.access_token, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(tools).not.toContain("create_invite");
    // "Every project" means every project the viewer may open.
    expect((await mcp(tokens.access_token, "tools/call", { name: "list_testimonials", arguments: {} })).body.result.structuredContent.project.slug).toBe("beta");
  });

  it("INT-04 refresh tokens rotate; reusing one revokes the connection", async () => {
    const { clientId, tokens } = await connect(ADMIN_EMAIL);
    const refreshed = await (await token(form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }))).json();
    expect(refreshed.access_token).toMatch(/^plo_/);
    expect((await mcp(tokens.access_token, "ping")).status).toBe(401);
    expect((await mcp(refreshed.access_token, "ping")).status).toBe(200);
    const reuse = await (await token(form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }))).json();
    expect(reuse.error).toBe("invalid_grant");
    expect((await mcp(refreshed.access_token, "ping")).status).toBe(401);
  });

  it("INT-04 revocation by the app, by an admin in Settings, or by removing the member stops the token", async () => {
    const first = await connect(ADMIN_EMAIL);
    await revoke(form("/api/oauth/revoke", { token: first.tokens.refresh_token }));
    expect((await mcp(first.tokens.access_token, "ping")).status).toBe(401);

    const second = await connect(ADMIN_EMAIL);
    const grants = (await (await grantsRoute(new Request("http://localhost/api/admin/oauth-grants", { headers: adminHeaders() }))).json()).grants;
    expect(grants).toEqual([expect.objectContaining({ clientName: "Claude", memberEmail: ADMIN_EMAIL, scope: "write", projectIds: null })]);
    await revokeGrantRoute(new Request(`http://localhost/api/admin/oauth-grants/${grants[0].id}`, { method: "DELETE", headers: adminHeaders() }), params({ id: grants[0].id }));
    expect((await mcp(second.tokens.access_token, "ping")).status).toBe(401);
    expect(listAudit({ action: "oauth.revoke" }, { limit: 5, offset: 0 }).total).toBe(2);

    const invited = await teamInvite(json("/api/admin/team", { email: "ed@example.com", role: "editor" }, { cookie: cookieFor(ADMIN_EMAIL), "sec-fetch-site": "same-origin" }));
    const memberId = (await invited.json()).member.id;
    const third = await connect("ed@example.com");
    expect((await mcp(third.tokens.access_token, "ping")).status).toBe(200);
    await removeMember(new Request(`http://localhost/api/admin/team/${memberId}`, { method: "DELETE", headers: adminHeaders() }), params({ id: memberId }));
    expect((await mcp(third.tokens.access_token, "ping")).status).toBe(401);
  });

  it("INT-04 API keys still work as the bearer token", async () => {
    const res = await mcpPost(json("/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer plk_not-a-real-key-at-all-000000" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});
