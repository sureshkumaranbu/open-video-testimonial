import { featureOn } from "@/lib/features";
import { exchangeCode, OAuthError, oauthFail, oauthJson, refreshTokens } from "@/lib/oauth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { preflight, readFields } from "../cors";

/** The token endpoint: authorization_code (with PKCE) and refresh_token, for public clients. */
export async function POST(req: Request) {
  if (!featureOn("mcp")) return new Response("Not found", { status: 404 });
  if (!rateLimit(`oauth-token:${clientKey(req)}`, 60, 60 * 1000)) return oauthFail(new OAuthError("invalid_request", "Too many requests; wait a minute", 429));
  const f = await readFields(req);
  if (!f) return oauthFail(new OAuthError("invalid_request", "Send the fields form-encoded"));
  try {
    const grant = f.get("grant_type");
    if (grant === "authorization_code") {
      return oauthJson(exchangeCode({ code: f.get("code"), clientId: f.get("client_id"), redirectUri: f.get("redirect_uri"), verifier: f.get("code_verifier") }));
    }
    if (grant === "refresh_token") return oauthJson(refreshTokens({ refreshToken: f.get("refresh_token"), clientId: f.get("client_id") }));
    return oauthFail(new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token"));
  } catch (err) {
    if (err instanceof OAuthError) return oauthFail(err);
    throw err;
  }
}

export const OPTIONS = preflight;
