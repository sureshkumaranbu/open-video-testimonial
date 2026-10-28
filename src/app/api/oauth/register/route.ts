import { featureOn } from "@/lib/features";
import { OAuthError, oauthFail, oauthJson, registerClient } from "@/lib/oauth";
import { clientKey } from "@/lib/rate-limit";
import { preflight } from "../cors";

/** RFC 7591 dynamic client registration: public clients only, rate-limited and capped. */
export async function POST(req: Request) {
  if (!featureOn("mcp")) return new Response("Not found", { status: 404 });
  const text = await req.text().catch(() => "");
  if (text.length > 16 * 1024) return oauthFail(new OAuthError("invalid_client_metadata", "The registration is too large"));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return oauthFail(new OAuthError("invalid_client_metadata", "Send the registration as JSON"));
  }
  try {
    return oauthJson(registerClient(body, clientKey(req)), 201);
  } catch (err) {
    if (err instanceof OAuthError) return oauthFail(err);
    throw err;
  }
}

export const OPTIONS = preflight;
