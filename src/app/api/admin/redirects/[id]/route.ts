import { jsonError, requireAdmin } from "@/lib/http";
import { deleteRedirect } from "@/lib/projects";

/** Stops an old link working: it 404s from then on, and any project may take the slug. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!deleteRedirect((await ctx.params).id)) return jsonError(404, "That old link no longer exists");
  return Response.json({ ok: true });
}
