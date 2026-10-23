import { z } from "zod";
import { isSameSiteRequest, readCookie } from "@/lib/auth";
import { sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { createLoginToken, LINK_COOKIE, LINK_SENT, linkCookieHeader, randomSecret } from "@/lib/login-links";
import { normalizeEmail, roleFor } from "@/lib/members";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { signInMethods } from "@/lib/sign-in";

const schema = z.object({ email: z.email().max(254) });
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Emails a sign-in link. The answer is the same whether or not the address
 * may sign in, and the email is sent in the background so the response time
 * doesn't tell either.
 */
export async function POST(req: Request) {
  if (!isSameSiteRequest(req)) return jsonError(403, "Cross-origin request blocked");
  if (!signInMethods().email) return jsonError(404, "Email sign-in isn't set up on this server");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Enter a valid email address");
  const email = normalizeEmail(parsed.data.email);
  if (!rateLimit(`email-link:ip:${clientKey(req)}`, 5, WINDOW_MS) || !rateLimit(`email-link:to:${email}`, 3, WINDOW_MS)) {
    return jsonError(429, "Too many links asked for. Please wait a few minutes and try again.");
  }
  // The link only works in a browser holding this secret. Keep an existing
  // one, so asking twice doesn't break the first link.
  const existing = readCookie(req, LINK_COOKIE);
  const secret = existing && /^[\w-]{43}$/.test(existing) ? existing : randomSecret();
  if (roleFor(email)) {
    const token = createLoginToken(email, "sign-in", secret);
    void sendMail({
      to: email,
      subject: "Your Plaudit sign-in link",
      text: `Here's your link to sign in to Plaudit at ${env.publicUrl}:

${env.publicUrl}/admin/login/link?token=${token}

It works once, for 15 minutes, in the browser where you asked for it.

If you didn't ask for this, you can ignore this email.
`,
    }).catch((err) => console.error("[sign-in link] couldn't send:", (err as Error).message));
  }
  return Response.json({ ok: true, message: LINK_SENT }, { headers: { "Set-Cookie": linkCookieHeader(secret, env.cookieSecure) } });
}
