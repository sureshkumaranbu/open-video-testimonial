/**
 * A stand-in for Google's and Apple's sign-in servers, for tests only. It
 * speaks just enough OpenID Connect for Plaudit: discovery, an authorize page
 * where the test picks who signs in, a token endpoint that checks the client
 * (Google: secret + PKCE; Apple: the ES256 client-secret JWT) and published
 * keys. Apple's answer is posted back cross-site (response_mode=form_post),
 * with the person's name only on their first sign-in, as Apple does.
 *
 *   node e2e/fixtures/mock-oidc.mjs   (MOCK_OIDC_PORT, MOCK_OIDC_HOST, MOCK_GOOGLE_SECRET,
 *                                      MOCK_APPLE_PUBLIC_KEY, MOCK_APPLE_TEAM_ID, MOCK_APPLE_KEY_ID)
 */
import crypto from "node:crypto";
import http from "node:http";
import { exportJWK, generateKeyPair, importSPKI, jwtVerify, SignJWT } from "jose";

const html = (body) => `<!doctype html><meta charset="utf-8"><title>Mock sign-in</title>${body}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function readForm(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
}

export async function startMockOidc({
  port = 0,
  host,
  advertiseHost = "localhost",
  googleSecret = "mock-google-secret",
  applePublicKey,
  appleTeamId = "MOCKTEAM01",
  appleKeyId = "MOCKKEY001",
} = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "mock-1", alg: "RS256", use: "sig" };
  const appleKey = applePublicKey ? await importSPKI(applePublicKey, "ES256") : null;
  const codes = new Map();
  const appleSeen = new Set();
  let base = "";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const [, provider, ...rest] = url.pathname.split("/");
    const route = rest.join("/");
    const issuer = `${base}/${provider}`;
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (provider !== "google" && provider !== "apple") return send(404, { error: "not_found" });
    try {
      if (route === ".well-known/openid-configuration") {
        return send(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      if (route === "jwks") return send(200, { keys: [jwk] });

      if (route === "authorize" && req.method === "GET") {
        const hidden = [...url.searchParams].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
        return send(
          200,
          html(`<h1>Mock ${provider} sign-in</h1>
<form method="post">${hidden}
<label>Email address <input name="email" type="email" required></label>
<label>Full name <input name="name" value="Mock Person"></label>
<label><input type="checkbox" name="verified" value="1" checked> Email verified</label>
<button type="submit">Continue</button></form>`),
          "text/html",
        );
      }

      if (route === "authorize" && req.method === "POST") {
        const f = await readForm(req);
        const code = crypto.randomBytes(16).toString("hex");
        codes.set(code, { ...f, provider, verified: f.verified === "1" });
        if (provider === "google") {
          const back = new URL(f.redirect_uri);
          back.searchParams.set("code", code);
          back.searchParams.set("state", f.state);
          res.writeHead(302, { location: back.toString() });
          return res.end();
        }
        // Apple: post the answer back to the app's site, the name only the first time.
        const first = !appleSeen.has(f.email);
        appleSeen.add(f.email);
        const [firstName, ...last] = (f.name || "").split(" ");
        const user = first ? JSON.stringify({ name: { firstName, lastName: last.join(" ") }, email: f.email }) : "";
        return send(
          200,
          html(`<form id="f" method="post" action="${esc(f.redirect_uri)}">
<input type="hidden" name="code" value="${code}"><input type="hidden" name="state" value="${esc(f.state)}">
${user ? `<input type="hidden" name="user" value="${esc(user)}">` : ""}
<button type="submit">Back to the app</button></form><script>document.getElementById("f").submit()</script>`),
          "text/html",
        );
      }

      if (route === "token" && req.method === "POST") {
        const f = await readForm(req);
        const grant = codes.get(f.code);
        codes.delete(f.code);
        if (!grant || grant.provider !== provider) return send(400, { error: "invalid_grant" });
        if (f.redirect_uri !== grant.redirect_uri || f.client_id !== grant.client_id) return send(400, { error: "invalid_grant" });
        if (provider === "google") {
          if (f.client_secret !== googleSecret) return send(401, { error: "invalid_client" });
          const challenge = crypto.createHash("sha256").update(f.code_verifier || "").digest("base64url");
          if (challenge !== grant.code_challenge) return send(400, { error: "invalid_grant", error_description: "PKCE check failed" });
        } else {
          try {
            const { payload, protectedHeader } = await jwtVerify(f.client_secret, appleKey, { issuer: appleTeamId, audience: issuer, subject: f.client_id });
            if (protectedHeader.alg !== "ES256" || protectedHeader.kid !== appleKeyId || !payload.exp) throw new Error("bad header");
          } catch {
            return send(401, { error: "invalid_client" });
          }
        }
        const relay = grant.email.endsWith("@privaterelay.appleid.com");
        const claims =
          provider === "google"
            ? { email: grant.email, email_verified: grant.verified, name: grant.name, nonce: grant.nonce, ...(grant.hd ? { hd: grant.hd } : {}) }
            : { email: grant.email, email_verified: String(grant.verified), is_private_email: String(relay), nonce: grant.nonce };
        const idToken = await new SignJWT(claims)
          .setProtectedHeader({ alg: "RS256", kid: "mock-1" })
          .setIssuer(issuer)
          .setAudience(grant.client_id)
          .setSubject(crypto.createHash("sha256").update(grant.email).digest("hex").slice(0, 20))
          .setIssuedAt()
          .setExpirationTime("10m")
          .sign(privateKey);
        return send(200, { access_token: "mock", token_type: "Bearer", id_token: idToken });
      }
      send(404, { error: "not_found" });
    } catch (err) {
      send(500, { error: "server_error", error_description: err.message });
    }
  });

  await new Promise((r) => (host ? server.listen(port, host, r) : server.listen(port, r)));
  base = `http://${advertiseHost}:${server.address().port}`;
  return { base, issuer: (p) => `${base}/${p}`, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = await startMockOidc({
    port: Number(process.env.MOCK_OIDC_PORT || 3999),
    advertiseHost: process.env.MOCK_OIDC_HOST || "localhost",
    googleSecret: process.env.MOCK_GOOGLE_SECRET,
    applePublicKey: process.env.MOCK_APPLE_PUBLIC_KEY,
    appleTeamId: process.env.MOCK_APPLE_TEAM_ID,
    appleKeyId: process.env.MOCK_APPLE_KEY_ID,
  });
  console.log(`mock OpenID provider at ${mock.base}`);
}
