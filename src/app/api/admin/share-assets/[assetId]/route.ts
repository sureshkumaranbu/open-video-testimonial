import { jsonError, requireRole } from "@/lib/http";
import { deleteAsset } from "@/lib/share/store";

/** Deletes a studio upload and its file. */
export async function DELETE(req: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!(await deleteAsset((await ctx.params).assetId))) return jsonError(404, "Not found");
  return Response.json({ ok: true });
}
