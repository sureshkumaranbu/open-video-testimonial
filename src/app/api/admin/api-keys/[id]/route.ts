import { auditRequest } from "@/lib/audit";
import { revokeApiKey } from "@/lib/api-keys";
import { jsonError, requireRole } from "@/lib/http";

/** Revokes a key immediately. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const row = revokeApiKey((await ctx.params).id);
  if (!row) return jsonError(404, "Key not found");
  auditRequest(req, "api_key.revoke", { objectType: "api_key", objectId: row.id, summary: `${row.name} (${row.prefix}…)` });
  return Response.json({ ok: true });
}
