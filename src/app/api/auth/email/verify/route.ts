import { isSameSiteRequest, readCookie } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clearLinkCookieHeader, consumeLoginToken, LINK_COOKIE, LINK_PROBLEMS } from "@/lib/login-links";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { completeSignIn } from "@/lib/sign-in";

/** The confirmation page's button: uses the link up and signs in. */
export async function POST(req: Request) {
  if (!isSameSiteRequest(req)) return jsonError(403, "Cross-origin request blocked");
  if (!rateLimit(`email-link-verify:${clientKey(req)}`, 20, 15 * 60 * 1000)) {
    return jsonError(429, "Too many attempts. Please wait a few minutes.");
  }
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const result = consumeLoginToken(token, readCookie(req, LINK_COOKIE));
  if ("problem" in result) return jsonError(400, LINK_PROBLEMS[result.problem!]);
  const cookie = completeSignIn(result.email, "email");
  if (!cookie) return jsonError(403, LINK_PROBLEMS["not-allowed"]);
  const headers = new Headers();
  headers.append("Set-Cookie", cookie);
  headers.append("Set-Cookie", clearLinkCookieHeader());
  return Response.json({ ok: true }, { headers });
}
