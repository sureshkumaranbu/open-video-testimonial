import { clearSessionCookieHeader } from "@/lib/auth";

export function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } });
}
