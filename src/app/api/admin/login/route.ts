import { checkCredentials, createSessionToken, isSameOrigin, sessionCookieHeader } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError(403, "Cross-origin request blocked");
  if (!rateLimit(`login:${clientIp(req)}`, 10, 15 * 60 * 1000)) {
    return jsonError(429, "Too many attempts, please wait a few minutes");
  }
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!checkCredentials(email, password)) return jsonError(401, "Wrong email or password");
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader(createSessionToken(email.trim().toLowerCase())) } },
  );
}
