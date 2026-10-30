import crypto from "node:crypto";
import fs from "node:fs";
import { createLocalJWKSet, exportJWK, generateKeyPair, importSPKI, jwtVerify, SignJWT, decodeProtectedHeader } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as passwordLogin } from "@/app/api/admin/login/route";
import { POST as logoutRoute } from "@/app/api/admin/logout/route";
import { DELETE as removeRoute } from "@/app/api/admin/team/[id]/route";
import { GET as teamList, POST as inviteRoute } from "@/app/api/admin/team/route";
import { GET as start } from "@/app/api/auth/[provider]/route";
import { GET as callbackGet, POST as callbackPost } from "@/app/api/auth/callback/[provider]/route";
import { POST as requestLink } from "@/app/api/auth/email/route";
import { POST as verifyLink } from "@/app/api/auth/email/verify/route";
import { getDb, schema } from "@/db";
import { createSessionToken, getRequestSession, sessionCookieName } from "@/lib/auth";
import { outboxDir } from "@/lib/email";
import { consumeLoginToken, createLoginToken, LINK_COOKIE, LINK_SENT, peekLoginToken, SIGN_IN_TTL_MS } from "@/lib/login-links";
import { recordSignIn, roleFor } from "@/lib/members";
import { appleClientSecret, verifyIdToken } from "@/lib/oidc";
import { resetRateLimits } from "@/lib/rate-limit";
import { signInMethods } from "@/lib/sign-in";
import { startMockOidc } from "../e2e/fixtures/mock-oidc.mjs";
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminHeaders, params, useTempDataDir } from "./helpers";

const VARS = [
  "ADMIN_EMAILS", "ALLOWED_EMAIL_DOMAINS", "PASSWORD_LOGIN", "MAIL_OUTBOX", "SMTP_URL", "PUBLIC_URL",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ISSUER", "GOOGLE_HOSTED_DOMAIN",
  "APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY", "APPLE_ISSUER",
];

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
  resetRateLimits();
  process.env.MAIL_OUTBOX = "true";
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50)); // let links emailed in the background land in this test's outbox
  for (const k of VARS) delete process.env[k];
  ctx.cleanup();
});

const ORIGIN = { origin: "http://localhost:3000", host: "localhost:3000" };
const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);
const outbox = () => (fs.existsSync(outboxDir()) ? fs.readdirSync(outboxDir()).map((f) => fs.readFileSync(`${outboxDir()}/${f}`, "utf8")) : []);
const settle = () => new Promise((r) => setTimeout(r, 50)); // links are emailed in the background
/** The token in an emailed link (the .eml is quoted-printable, so "=" arrives as "=3D"). */
const linkIn = (mail: string) => /token=([\w-]+)/.exec(mail.replace(/=\r?\n/g, "").replace(/=3D/g, "="))![1];

function ask(email: string, cookie = "", headers: Record<string, string> = ORIGIN) {
  return requestLink(
    new Request("http://localhost:3000/api/auth/email", {
      method: "POST",
      body: JSON.stringify({ email }),
      headers: { ...headers, "content-type": "application/json", "x-forwarded-for": "198.51.100.7", cookie },
    }),
  );
}
function confirm(token: string, cookie = "") {
  return verifyLink(
    new Request("http://localhost:3000/api/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { ...ORIGIN, "content-type": "application/json", cookie },
    }),
  );
}
const asSession = (cookieHeader: string) =>
  getRequestSession(new Request("http://localhost/", { headers: { cookie: cookieHeader } }));

describe("email links", () => {
  it("are stored only as a hash, work once, and expire after 15 minutes", () => {
    const now = Date.now();
    const token = createLoginToken(ADMIN_EMAIL, "sign-in", "browser-secret", now);
    const row = getDb().select().from(schema.loginTokens).get()!;
    expect(row.tokenHash).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - now).toBe(SIGN_IN_TTL_MS);

    expect(peekLoginToken(token, "browser-secret", now)).toEqual({ email: ADMIN_EMAIL, purpose: "sign-in" });
    expect(consumeLoginToken(token, "browser-secret", now + SIGN_IN_TTL_MS)).toEqual({ problem: "expired" });
    expect(consumeLoginToken(token, "browser-secret", now)).toEqual({ email: ADMIN_EMAIL, purpose: "sign-in" });
    expect(consumeLoginToken(token, "browser-secret", now)).toEqual({ problem: "used" });
    expect(consumeLoginToken("made-up", "browser-secret", now)).toEqual({ problem: "invalid" });
  });

  it("only work in the browser that asked for them; invitations work anywhere", () => {
    const token = createLoginToken(ADMIN_EMAIL, "sign-in", "mine");
    expect(consumeLoginToken(token, "someone-else")).toEqual({ problem: "other-browser" });
    expect(consumeLoginToken(token, undefined)).toEqual({ problem: "other-browser" });
    expect(consumeLoginToken(token, "mine")).toMatchObject({ email: ADMIN_EMAIL });
    const invite = createLoginToken("new@example.com", "invite");
    expect(consumeLoginToken(invite, undefined)).toEqual({ email: "new@example.com", purpose: "invite" });
  });

  it("answer the same whether or not the address may sign in, and only email allowed ones", async () => {
    const yes = await ask(ADMIN_EMAIL.toUpperCase());
    const no = await ask("stranger@example.com");
    expect(yes.status).toBe(200);
    expect(no.status).toBe(200);
    expect(await yes.json()).toEqual({ ok: true, message: LINK_SENT });
    expect(await no.json()).toEqual({ ok: true, message: LINK_SENT });
    expect(cookieOf(yes, LINK_COOKIE)).toMatch(/^[\w-]{43}$/);
    expect(cookieOf(no, LINK_COOKIE)).toMatch(/^[\w-]{43}$/);
    await settle();
    const mails = outbox();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain(`To: ${ADMIN_EMAIL}`);
  });

  it("sign in from the confirmation button, in the same browser, once", async () => {
    const res = await ask(ADMIN_EMAIL);
    const secret = cookieOf(res, LINK_COOKIE)!;
    await settle();
    const token = linkIn(outbox()[0]);
    expect((await confirm(token, `${LINK_COOKIE}=other`)).status).toBe(400);
    const ok = await confirm(token, `${LINK_COOKIE}=${secret}`);
    expect(ok.status).toBe(200);
    const session = cookieOf(ok, sessionCookieName())!;
    expect(asSession(`${sessionCookieName()}=${session}`)).toEqual({ email: ADMIN_EMAIL, role: "owner" });
    expect(cookieOf(ok, LINK_COOKIE)).toBe(""); // cleared
    const again = await confirm(token, `${LINK_COOKIE}=${secret}`);
    expect(again.status).toBe(400);
    expect((await again.json()).error).toMatch(/already been used/);
  });

  it("asking twice keeps the browser's secret, so the first link still works", async () => {
    const first = await ask(ADMIN_EMAIL);
    const secret = cookieOf(first, LINK_COOKIE)!;
    const second = await ask(ADMIN_EMAIL, `${LINK_COOKIE}=${secret}`);
    expect(cookieOf(second, LINK_COOKIE)).toBe(secret);
  });

  it("are rate limited per client, and refused cross-site", async () => {
    const perClient = [];
    for (let i = 0; i < 6; i++) perClient.push((await ask(`person${i}@example.com`)).status);
    expect(perClient).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await ask(ADMIN_EMAIL, "", { origin: "https://evil.example", host: "localhost:3000" })).status).toBe(403);
  });

  it("asking for someone else's links can't lock them out: per-address limits stay quiet and count per client", async () => {
    const from = (ip: string) => ({ ...ORIGIN, "x-forwarded-for": ip });
    const askFrom = (ip: string) =>
      requestLink(
        new Request("http://localhost:3000/api/auth/email", {
          method: "POST",
          body: JSON.stringify({ email: ADMIN_EMAIL }),
          headers: { ...from(ip), "content-type": "application/json" },
        }),
      );
    const mailsToOwner = async () => {
      await settle();
      return outbox().filter((m) => m.includes(`To: ${ADMIN_EMAIL}`)).length;
    };
    // An attacker asks for the owner's link again and again: the answer never changes…
    for (let i = 0; i < 5; i++) {
      const res = await askFrom("203.0.113.66");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, message: LINK_SENT });
    }
    expect(await mailsToOwner()).toBe(3); // …and only 3 are sent for them
    // The owner, elsewhere, still gets theirs.
    expect((await askFrom("198.51.100.200")).status).toBe(200);
    expect(await mailsToOwner()).toBe(4);
    // Across many clients the address is capped at 10 per 15 minutes.
    for (let i = 1; i <= 8; i++) expect((await askFrom(`192.0.2.${i}`)).status).toBe(200);
    expect(await mailsToOwner()).toBe(10);
  });

  it("aren't offered when email isn't set up", async () => {
    delete process.env.MAIL_OUTBOX;
    expect(signInMethods().email).toBe(false);
    expect((await ask(ADMIN_EMAIL)).status).toBe(404);
  });
});

describe("who can sign in", () => {
  it("the owner, ADMIN_EMAILS, allowed domains and invited people", () => {
    process.env.ADMIN_EMAILS = "Ada@Example.com, grace@example.com";
    process.env.ALLOWED_EMAIL_DOMAINS = "@acme.example";
    expect(roleFor(ADMIN_EMAIL)).toBe("owner");
    expect(roleFor("ada@example.com")).toBe("admin");
    expect(roleFor("anyone@acme.example")).toBe("admin");
    expect(roleFor("anyone@notacme.example")).toBeNull();
    expect(roleFor("stranger@example.com")).toBeNull();
  });

  it("taking someone out of ADMIN_EMAILS locks them out, even after they've signed in", () => {
    process.env.ADMIN_EMAILS = "ada@example.com";
    recordSignIn("ada@example.com", "Ada");
    expect(roleFor("ada@example.com")).toBe("admin");
    delete process.env.ADMIN_EMAILS;
    expect(roleFor("ada@example.com")).toBeNull();
    expect(asSession(`${sessionCookieName()}=${createSessionToken("ada@example.com")}`)).toBeNull();
  });

  it("the session cookie's name depends on PUBLIC_URL, so two local servers don't clash", () => {
    process.env.PUBLIC_URL = "http://localhost:3000";
    const a = sessionCookieName();
    process.env.PUBLIC_URL = "http://localhost:3001";
    expect(sessionCookieName()).not.toBe(a);
  });

  it("PASSWORD_LOGIN=false turns password sign-in off only once another method works", async () => {
    process.env.PASSWORD_LOGIN = "false";
    delete process.env.MAIL_OUTBOX;
    expect(signInMethods()).toMatchObject({ password: true, passwordKeptOn: true });
    process.env.MAIL_OUTBOX = "true";
    expect(signInMethods()).toMatchObject({ password: false, email: true });
    const res = await passwordLogin(
      new Request("http://localhost/api/admin/login", { method: "POST", body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("signing out (B-05)", () => {
  const signIn = async () => {
    const res = await passwordLogin(
      new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
        headers: { ...ORIGIN, "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
      }),
    );
    expect(res.status).toBe(200);
    return `${sessionCookieName()}=${cookieOf(res, sessionCookieName())}`;
  };
  const signOut = (cookie: string) => logoutRoute(new Request("http://localhost:3000/api/admin/logout", { method: "POST", headers: { ...ORIGIN, cookie } }));
  afterEach(() => vi.restoreAllMocks());

  it("signing out ends every session of that person, including a copied cookie, and only theirs (B-05)", async () => {
    process.env.ADMIN_EMAILS = "ada@example.com";
    recordSignIn("ada@example.com");
    const laptop = await signIn();
    const phone = await signIn();
    const ada = `${sessionCookieName()}=${createSessionToken("ada@example.com")}`;
    expect(asSession(laptop)?.email).toBe(ADMIN_EMAIL);
    const res = await signOut(laptop);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join()).toContain("Max-Age=0");
    expect(asSession(laptop)).toBeNull();
    expect(asSession(phone)).toBeNull();
    expect(asSession(ada)?.email).toBe("ada@example.com");
    // Signing in again works straight away.
    expect(asSession(await signIn())?.email).toBe(ADMIN_EMAIL);
  });

  it("a session made in the same millisecond as the sign-out ends with it; one made after it works (B-05)", async () => {
    const t = Date.parse("2026-10-30T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(t);
    const before = `${sessionCookieName()}=${createSessionToken(ADMIN_EMAIL, "password", t)}`;
    await signOut(before);
    expect(asSession(before)).toBeNull();
    const after = `${sessionCookieName()}=${createSessionToken(ADMIN_EMAIL, "password", t)}`;
    expect(asSession(after)?.email).toBe(ADMIN_EMAIL);
  });

  it("someone removed and invited again doesn't get their old sessions back (B-05)", async () => {
    const add = () => inviteRoute(new Request("http://localhost/api/admin/team", { method: "POST", body: JSON.stringify({ email: "bo@example.com" }), headers: { ...adminHeaders(), "content-type": "application/json" } }));
    expect((await add()).status).toBe(201);
    recordSignIn("bo@example.com");
    const old = `${sessionCookieName()}=${createSessionToken("bo@example.com", "email", Date.now() - 1000)}`;
    expect(asSession(old)?.email).toBe("bo@example.com");
    const id = getDb().select().from(schema.members).all().find((m) => m.email === "bo@example.com")!.id;
    expect((await removeRoute(new Request(`http://localhost/api/admin/team/${id}`, { method: "DELETE", headers: adminHeaders() }), params({ id }))).status).toBe(200);
    expect((await add()).status).toBe(201);
    expect(asSession(old)).toBeNull();
  });

  it("signing out without a session changes nothing (B-05)", async () => {
    const cookie = await signIn();
    expect((await signOut("")).status).toBe(200);
    expect(asSession(cookie)?.email).toBe(ADMIN_EMAIL);
  });
});

describe("Settings → Team", () => {
  const owner = (url: string, init: RequestInit = {}) =>
    new Request(`http://localhost${url}`, { ...init, headers: { ...adminHeaders(), "content-type": "application/json" } });

  it("the owner invites someone, who activates with the link; removing them signs them out", async () => {
    const res = await inviteRoute(owner("/api/admin/team", { method: "POST", body: JSON.stringify({ email: "New@Example.com" }) }));
    expect(res.status).toBe(201);
    const { member, sent } = await res.json();
    expect(member.email).toBe("new@example.com");
    expect(sent).toBe(true);
    const mail = outbox().find((m) => m.includes("To: new@example.com"))!;
    expect(mail).toContain("You're invited to Plaudit");

    // Any browser: the invitee wasn't the one who asked for it.
    const ok = await confirm(linkIn(mail));
    expect(ok.status).toBe(200);
    const cookie = `${sessionCookieName()}=${cookieOf(ok, sessionCookieName())}`;
    expect(asSession(cookie)).toEqual({ email: "new@example.com", role: "admin" });

    // An admin can see the team but not change it.
    const asAdmin = { cookie, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    expect((await teamList(new Request("http://localhost/api/admin/team", { headers: asAdmin }))).status).toBe(200);
    const denied = await inviteRoute(new Request("http://localhost/api/admin/team", { method: "POST", headers: asAdmin, body: JSON.stringify({ email: "x@example.com" }) }));
    expect(denied.status).toBe(403);

    const team = (await (await teamList(owner("/api/admin/team"))).json()).team;
    expect(team.map((m: { email: string; access: string; activatedAt: string | null }) => [m.email, m.access, Boolean(m.activatedAt)])).toEqual([
      [ADMIN_EMAIL, "owner", false],
      ["new@example.com", "invited", true],
    ]);

    expect((await removeRoute(owner(`/api/admin/team/${member.id}`, { method: "DELETE" }), params({ id: member.id }))).status).toBe(200);
    expect(asSession(cookie)).toBeNull();
  });

  it("won't invite someone who can already sign in, or remove people the server's settings allow", async () => {
    const dup = await inviteRoute(owner("/api/admin/team", { method: "POST", body: JSON.stringify({ email: ADMIN_EMAIL }) }));
    expect(dup.status).toBe(409);
    process.env.ADMIN_EMAILS = "ada@example.com";
    recordSignIn("ada@example.com");
    const row = getDb().select().from(schema.members).all().find((m) => m.email === "ada@example.com")!;
    const res = await removeRoute(owner(`/api/admin/team/${row.id}`, { method: "DELETE" }), params({ id: row.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ADMIN_EMAILS/);
  });

  it("without email, hands the owner the invitation link to send", async () => {
    delete process.env.MAIL_OUTBOX;
    const body = await (await inviteRoute(owner("/api/admin/team", { method: "POST", body: JSON.stringify({ email: "b@example.com" }) }))).json();
    expect(body).toMatchObject({ sent: false, link: expect.stringMatching(/\/admin\/login\/link\?token=[\w-]+$/) });
  });
});

describe("id_token checks", () => {
  let key: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;
  let otherKey: CryptoKey;
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    key = pair.privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
    otherKey = (await generateKeyPair("RS256")).privateKey;
  });
  const ISS = "https://accounts.google.com";
  const token = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string; signWith?: CryptoKey } = {}) =>
    new SignJWT({ email: "ada@example.com", email_verified: true, nonce: "n-1", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? ISS)
      .setAudience(opts.aud ?? "client-1")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(opts.signWith ?? key);
  const check = async (t: Promise<string>, extra: Partial<Parameters<typeof verifyIdToken>[1]> = {}) =>
    verifyIdToken(await t, { issuer: [ISS, "accounts.google.com"], audience: "client-1", nonce: "n-1", jwks, ...extra });

  it("accepts a good token", async () => {
    expect(await check(token({ name: "Ada" }))).toEqual({ email: "ada@example.com", name: "Ada", privateRelay: false });
    expect((await check(token({}, { iss: "accounts.google.com" }))).email).toBe("ada@example.com");
  });

  it("refuses the wrong issuer, audience, nonce, signature or an expired token", async () => {
    await expect(check(token({}, { iss: "https://evil.example" }))).rejects.toThrow(/didn't check out.*iss/);
    await expect(check(token({}, { aud: "someone-else" }))).rejects.toThrow(/didn't check out.*aud/);
    await expect(check(token({ nonce: "n-2" }))).rejects.toThrow(/different sign-in/);
    await expect(check(token({ nonce: undefined }))).rejects.toThrow(/different sign-in/);
    await expect(check(token({}, { signWith: otherKey }))).rejects.toThrow(/signature/);
    await expect(check(token({}, { exp: "-5m" }))).rejects.toThrow(/exp/);
  });

  it("needs a verified email, and the Workspace domain when one is set", async () => {
    await expect(check(token({ email_verified: false }))).rejects.toMatchObject({ reason: "unverified" });
    await expect(check(token({ email: undefined }))).rejects.toMatchObject({ reason: "unverified" });
    await expect(check(token({ hd: "other.example" }), { hostedDomain: "acme.example" })).rejects.toMatchObject({ reason: "wrong-domain" });
    expect((await check(token({ hd: "acme.example" }), { hostedDomain: "acme.example" })).email).toBe("ada@example.com");
  });

  it("reads Apple's string booleans and private relay addresses", async () => {
    const relay = await check(token({ email: "abc@privaterelay.appleid.com", email_verified: "true", is_private_email: "true" }));
    expect(relay).toMatchObject({ email: "abc@privaterelay.appleid.com", privateRelay: true });
  });
});

describe("Google and Apple, end to end against a stand-in provider", () => {
  let mock: Awaited<ReturnType<typeof startMockOidc>>;
  let apple: { privateKey: string; publicKey: string };
  beforeAll(async () => {
    const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    apple = {
      privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
    mock = await startMockOidc({ applePublicKey: apple.publicKey, host: "127.0.0.1", advertiseHost: "127.0.0.1" });
  });
  afterAll(() => mock.close());
  beforeEach(() => {
    Object.assign(process.env, {
      PUBLIC_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "mock-google-secret",
      GOOGLE_ISSUER: mock.issuer("google"),
      APPLE_CLIENT_ID: "com.example.plaudit",
      APPLE_TEAM_ID: "MOCKTEAM01",
      APPLE_KEY_ID: "MOCKKEY001",
      APPLE_PRIVATE_KEY: apple.privateKey.replace(/\n/g, "\\n"), // as it often arrives from a .env file
      APPLE_ISSUER: mock.issuer("apple"),
    });
  });

  /** Starts a sign-in, "picks" the account at the provider, and returns where the provider sends the browser. */
  async function signInAt(provider: "google" | "apple", email: string, flowCookie?: string) {
    const started = await start(new Request(`http://localhost:3000/api/auth/${provider}`), params({ provider }));
    expect(started.status).toBe(302);
    const authorize = new URL(started.headers.get("location")!);
    const flow = flowCookie ?? cookieOf(started, "plaudit_oauth")!;
    const answer = await fetch(authorize, {
      method: "POST",
      body: new URLSearchParams({ ...Object.fromEntries(authorize.searchParams), email, name: "Ada Lovelace", verified: "1" }),
      redirect: "manual",
    });
    return { authorize, flow, answer };
  }

  it("Google: PKCE, state, nonce, and a fresh session", async () => {
    const { authorize, flow, answer } = await signInAt("google", ADMIN_EMAIL);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/google");
    const back = new URL(answer.headers.get("location")!);
    const res = await callbackGet(new Request(back, { headers: { cookie: `plaudit_oauth=${flow}` } }), params({ provider: "google" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/admin");
    expect(asSession(`${sessionCookieName()}=${cookieOf(res, sessionCookieName())}`)).toEqual({ email: ADMIN_EMAIL, role: "owner" });

    // The same callback can't be replayed.
    const replay = await callbackGet(new Request(back, { headers: { cookie: `plaudit_oauth=${flow}` } }), params({ provider: "google" }));
    expect(replay.headers.get("location")).toMatch(/error=expired/);
  });

  it("Google: a callback that started in another browser is refused", async () => {
    const { answer } = await signInAt("google", ADMIN_EMAIL);
    const back = new URL(answer.headers.get("location")!);
    const res = await callbackGet(new Request(back, { headers: { cookie: "plaudit_oauth=attackers-flow" } }), params({ provider: "google" }));
    expect(res.headers.get("location")).toMatch(/error=expired/);
    expect(cookieOf(res, sessionCookieName())).toBeUndefined();
  });

  it("Google: an address that isn't allowed gets a clear no", async () => {
    const { flow, answer } = await signInAt("google", "stranger@example.com");
    const res = await callbackGet(new Request(answer.headers.get("location")!, { headers: { cookie: `plaudit_oauth=${flow}` } }), params({ provider: "google" }));
    expect(res.headers.get("location")).toBe("http://localhost:3000/admin/login?error=not-allowed&email=stranger%40example.com");
  });

  it("Apple: the cross-site form_post is parked, then finished with the browser's cookie; the name arrives once", async () => {
    process.env.ADMIN_EMAILS = "ada@example.com";
    const { authorize, flow, answer } = await signInAt("apple", "ada@example.com");
    expect(authorize.searchParams.get("response_mode")).toBe("form_post");
    const page = await answer.text();
    const field = (name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(page)?.[1]?.replace(/&#34;/g, '"');
    // Cross-site POST: no cookies come with it.
    const posted = await callbackPost(
      new Request("http://localhost:3000/api/auth/callback/apple", {
        method: "POST",
        body: new URLSearchParams({ code: field("code")!, state: field("state")!, user: field("user")! }),
      }),
      params({ provider: "apple" }),
    );
    expect(posted.status).toBe(303);
    const next = posted.headers.get("location")!;
    expect(next).toMatch(/^http:\/\/localhost:3000\/api\/auth\/callback\/apple\?state=/);
    const res = await callbackGet(new Request(next, { headers: { cookie: `plaudit_oauth=${flow}` } }), params({ provider: "apple" }));
    expect(res.headers.get("location")).toBe("http://localhost:3000/admin");
    const member = getDb().select().from(schema.members).all().find((m) => m.email === "ada@example.com")!;
    expect(member.name).toBe("Ada Lovelace");
  });

  it("Apple: the client secret is an ES256 JWT for the team, Services ID and key", async () => {
    const secret = await appleClientSecret();
    expect(decodeProtectedHeader(secret)).toEqual({ alg: "ES256", kid: "MOCKKEY001" });
    const { payload } = await jwtVerify(secret, await importSPKI(apple.publicKey, "ES256"), {
      issuer: "MOCKTEAM01",
      subject: "com.example.plaudit",
      audience: mock.issuer("apple"),
    });
    expect(payload.exp! - payload.iat!).toBe(3600);
    expect(await appleClientSecret()).toBe(secret); // cached
  });

  it("Apple: a private relay address that wasn't invited says how to fix it", async () => {
    const relay = "x1y2z3@privaterelay.appleid.com";
    const { flow, answer } = await signInAt("apple", relay);
    const page = await answer.text();
    const field = (name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(page)?.[1];
    const posted = await callbackPost(
      new Request("http://localhost:3000/api/auth/callback/apple", { method: "POST", body: new URLSearchParams({ code: field("code")!, state: field("state")! }) }),
      params({ provider: "apple" }),
    );
    const res = await callbackGet(new Request(posted.headers.get("location")!, { headers: { cookie: `plaudit_oauth=${flow}` } }), params({ provider: "apple" }));
    expect(res.headers.get("location")).toMatch(/error=private-relay/);
  });

  it("only offers the providers that are fully set up", () => {
    expect(signInMethods()).toMatchObject({ google: true, apple: true });
    delete process.env.APPLE_KEY_ID;
    const m = signInMethods();
    expect(m.apple).toBe(false);
    expect(m.status.apple.missing).toEqual(["APPLE_KEY_ID"]);
  });
});
