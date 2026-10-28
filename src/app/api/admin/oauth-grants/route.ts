import { jsonError, requireRole } from "@/lib/http";
import { featureOn } from "@/lib/features";
import { listGrants } from "@/lib/oauth";

/** Settings › API keys: the AI assistants members connected with OAuth (INT-04). Admins only. */
export function GET(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  if (!featureOn("mcp")) return jsonError(404, "Not found");
  return Response.json({ grants: listGrants() });
}
