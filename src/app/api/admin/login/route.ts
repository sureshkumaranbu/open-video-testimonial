import { checkCredentials, createSessionToken, isSameOrigin, sessionCookieHeader } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clearRateLimit, clientIp, loginDelayMs, rateCount, rateLimit } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60 * 1000;
/** Wrong passwords one client may try per window before it gets 429s. */
const FAILURES_PER_CLIENT = 10;
const ALL_FAILURES = "login-fail:all";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError(403, "Cross-origin request blocked");
  // Clients we can't identify have no per-client limit (it would be one
  // bucket shared by everyone); the account backoff still applies to them.
  const ip = clientIp(req);
  const clientFailures = ip ? `login-fail:${ip}` : null;
  if (clientFailures && rateCount(clientFailures) >= FAILURES_PER_CLIENT) {
    return jsonError(429, "Too many attempts, please wait a few minutes");
  }
  const delay = loginDelayMs(rateCount(ALL_FAILURES));
  if (delay) await new Promise((r) => setTimeout(r, delay));

  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!checkCredentials(email, password)) {
    if (clientFailures) rateLimit(clientFailures, Infinity, WINDOW_MS);
    rateLimit(ALL_FAILURES, Infinity, WINDOW_MS);
    return jsonError(401, "Wrong email or password");
  }
  if (clientFailures) clearRateLimit(clientFailures);
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookieHeader(createSessionToken(email.trim().toLowerCase())) } },
  );
}
