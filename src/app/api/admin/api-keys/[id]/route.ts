import { revokeApiKey } from "@/lib/api-keys";
import { jsonError, requireAdmin } from "@/lib/http";

/** Revokes a key immediately. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!revokeApiKey((await ctx.params).id)) return jsonError(404, "Key not found");
  return Response.json({ ok: true });
}
