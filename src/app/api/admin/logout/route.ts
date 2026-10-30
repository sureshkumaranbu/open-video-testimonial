import { clearSessionCookieHeader, getRequestSession } from "@/lib/auth";
import { signOutEverywhere } from "@/lib/members";

/** Signs out: clears this browser's cookie and ends every other session of the same person (B-05). */
export function POST(req: Request) {
  const session = getRequestSession(req);
  if (session) signOutEverywhere(session.email);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
}
