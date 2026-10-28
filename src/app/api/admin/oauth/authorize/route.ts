import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { approve, deny, OAuthError, RESUME_COOKIE, verifyRequest } from "@/lib/oauth";
import { featureOn } from "@/lib/features";

const body = z.object({
  req: z.string().max(4000),
  decision: z.enum(["allow", "deny"]),
  scope: z.enum(["read", "write"]).default("read"),
  projectIds: z.array(z.string().max(64)).max(200).nullable().default(null),
});

/**
 * The consent page's answer (INT-04): `{req, decision, scope, projectIds}`.
 * Answers `{redirect}`, the app's own registered redirect URI with the code
 * (or access_denied) and its state; the page then goes there.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  if (!featureOn("mcp")) return jsonError(404, "Not found");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Choose Allow or Deny");
  const r = verifyRequest(parsed.data.req);
  if (!r) return jsonError(400, "This request expired. Start connecting again from the app.");
  let redirect: string;
  try {
    redirect = parsed.data.decision === "deny" ? deny(r) : approve(r, getRequestSession(req)!.email, { scope: parsed.data.scope, projectIds: parsed.data.projectIds });
  } catch (err) {
    if (err instanceof OAuthError) return jsonError(err.status, err.message);
    throw err;
  }
  return Response.json({ redirect }, { headers: { "Cache-Control": "no-store", "Set-Cookie": `${RESUME_COOKIE}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0` } });
}
