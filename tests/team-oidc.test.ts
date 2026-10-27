import http from "node:http";
import type { AddressInfo } from "node:net";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as start } from "@/app/api/auth/[provider]/route";
import { GET as callbackGet } from "@/app/api/auth/callback/[provider]/route";
import { getRequestSession, sessionCookieName } from "@/lib/auth";
import { verifyIdToken } from "@/lib/oidc";
import { signInMethods } from "@/lib/sign-in";
import { startMockOidc } from "../e2e/fixtures/mock-oidc.mjs";
import { ADMIN_EMAIL, params, useTempDataDir } from "./helpers";

const VARS = ["PUBLIC_URL", "ADMIN_EMAILS", "ALLOWED_EMAIL_DOMAINS", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_LABEL", "OIDC_SCOPES", "OIDC_EMAIL_DOMAINS", "OIDC_TRUST_EMAIL"];

let ctx: ReturnType<typeof useTempDataDir>;
let mock: Awaited<ReturnType<typeof startMockOidc>>;
beforeAll(async () => {
  mock = await startMockOidc({ host: "127.0.0.1", advertiseHost: "127.0.0.1", oidcSecret: "s3cret with space" });
});
afterAll(() => mock.close());
beforeEach(() => {
  ctx = useTempDataDir();
  Object.assign(process.env, {
    PUBLIC_URL: "http://localhost:3000",
    OIDC_ISSUER: mock.issuer("oidc"),
    OIDC_CLIENT_ID: "plaudit-app",
    OIDC_CLIENT_SECRET: "s3cret with space",
    OIDC_LABEL: "Okta",
  });
});
afterEach(() => {
  for (const k of VARS) delete process.env[k];
  ctx.cleanup();
});

const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);

/** Starts a sign-in, picks the account at the stand-in provider, then follows it back to the callback. */
async function signIn(email: string, o: { verified?: boolean } = {}) {
  const started = await start(new Request("http://localhost:3000/api/auth/oidc"), params({ provider: "oidc" }));
  expect(started.status).toBe(302);
  const authorize = new URL(started.headers.get("location")!);
  const flow = cookieOf(started, "plaudit_oauth")!;
  const answer = await fetch(authorize, {
    method: "POST",
    body: new URLSearchParams({ ...Object.fromEntries(authorize.searchParams), email, name: "Ada Lovelace", ...(o.verified === false ? {} : { verified: "1" }) }),
    redirect: "manual",
  });
  const back = new URL(answer.headers.get("location")!);
  const res = await callbackGet(new Request(back, { headers: { cookie: `plaudit_oauth=${flow}` } }), params({ provider: "oidc" }));
  return { authorize, res, location: res.headers.get("location")!, session: cookieOf(res, sessionCookieName()) };
}

describe("TEAM-03 generic OpenID Connect sign-in", () => {
  it("TEAM-03 is offered only when the issuer, client id and secret are set, under its own label", () => {
    expect(signInMethods()).toMatchObject({ oidc: true, oidcLabel: "Okta" });
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_LABEL;
    const m = signInMethods();
    expect(m).toMatchObject({ oidc: false, oidcLabel: "single sign-on" });
    expect(m.status.oidc.missing).toEqual(["OIDC_CLIENT_SECRET"]);
  });

  it("TEAM-03 discovery, PKCE, state and nonce, HTTP Basic client auth, an ES256 token, then a session; the callback always lands on /admin", async () => {
    process.env.OIDC_SCOPES = "email profile groups";
    const { authorize, res, location, session } = await signIn(ADMIN_EMAIL);
    expect(authorize.origin + authorize.pathname).toBe(`${mock.base}/oidc/authorize`);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "plaudit-app",
      redirect_uri: "http://localhost:3000/api/auth/callback/oidc",
      scope: "openid email profile groups",
      code_challenge_method: "S256",
    });
    expect(authorize.searchParams.get("state")).toBeTruthy();
    expect(authorize.searchParams.get("nonce")).toBeTruthy();
    expect(res.status).toBe(303);
    expect(location).toBe("http://localhost:3000/admin");
    const req = new Request("http://localhost:3000/admin", { headers: { cookie: `${sessionCookieName()}=${session}` } });
    expect(getRequestSession(req)).toEqual({ email: ADMIN_EMAIL, role: "owner" });
  });

  it("TEAM-03 the same access rules as every method: an unknown address is told no, an allowed domain gets in", async () => {
    const stranger = await signIn("stranger@example.com");
    expect(stranger.location).toBe("http://localhost:3000/admin/login?error=not-allowed&email=stranger%40example.com");
    expect(stranger.session).toBeUndefined();
    process.env.ALLOWED_EMAIL_DOMAINS = "team.example";
    expect((await signIn("grace@team.example")).location).toBe("http://localhost:3000/admin");
  });

  it("TEAM-03 needs email_verified unless OIDC_TRUST_EMAIL says the provider's addresses can be trusted", async () => {
    expect((await signIn(ADMIN_EMAIL, { verified: false })).location).toMatch(/error=unverified/);
    process.env.OIDC_TRUST_EMAIL = "true";
    expect((await signIn(ADMIN_EMAIL, { verified: false })).location).toBe("http://localhost:3000/admin");
  });

  it("TEAM-03 OIDC_EMAIL_DOMAINS limits which addresses the provider may vouch for (it lets no one in by itself)", async () => {
    process.env.OIDC_EMAIL_DOMAINS = "@acme.example";
    expect((await signIn(ADMIN_EMAIL)).location).toMatch(/error=sso-domain/);
    expect((await signIn("ada@acme.example")).location).toMatch(/error=not-allowed/);
  });

  it("TEAM-03 refuses a discovery document that names another issuer", async () => {
    const fake = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ issuer: "https://evil.example", authorization_endpoint: "https://evil.example/a", token_endpoint: "https://evil.example/t", jwks_uri: "https://evil.example/k" }));
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    try {
      process.env.OIDC_ISSUER = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/realms/acme`;
      const res = await start(new Request("http://localhost:3000/api/auth/oidc"), params({ provider: "oidc" }));
      expect(res.headers.get("location")).toBe("http://localhost:3000/admin/login?error=failed");
    } finally {
      await new Promise((r) => fake.close(r));
    }
  });
});

describe("TEAM-03 id_token checks for generic providers", () => {
  let es: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;
  beforeAll(async () => {
    const pair = await generateKeyPair("ES256");
    es = pair.privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "e1", alg: "ES256" }] });
  });
  const ISS = "https://sso.acme.example/";
  const token = (claims: Record<string, unknown>, aud: string | string[] = "app") =>
    new SignJWT({ email: "ada@acme.example", email_verified: true, nonce: "n", ...claims })
      .setProtectedHeader({ alg: "ES256", kid: "e1" })
      .setIssuer(ISS)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(es);
  const check = async (t: Promise<string>, extra: Partial<Parameters<typeof verifyIdToken>[1]> = {}) =>
    verifyIdToken(await t, { issuer: ISS, audience: "app", nonce: "n", jwks, algorithms: ["ES256"], ...extra });

  it("TEAM-03 accepts the algorithms the provider lists, and nothing else", async () => {
    expect((await check(token({}))).email).toBe("ada@acme.example");
    await expect(check(token({}), { algorithms: ["RS256"] })).rejects.toMatchObject({ reason: "failed" });
  });

  it("TEAM-03 a token for several audiences must name us as azp", async () => {
    await expect(check(token({}, ["app", "other"]))).rejects.toThrow(/another app/);
    expect((await check(token({ azp: "app" }, ["app", "other"]))).email).toBe("ada@acme.example");
  });

  it("TEAM-03 trusting the provider never covers an address it marks unverified", async () => {
    expect((await check(token({ email_verified: undefined }), { trustEmail: true })).email).toBe("ada@acme.example");
    await expect(check(token({ email_verified: false }), { trustEmail: true })).rejects.toMatchObject({ reason: "unverified" });
    await expect(check(token({ email_verified: undefined }))).rejects.toMatchObject({ reason: "unverified" });
  });
});
