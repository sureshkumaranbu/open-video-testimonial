import { jsonError, requireRole } from "@/lib/http";
import { deleteRequest } from "@/lib/requests";

/** Removes a request. Its link stops working; a testimonial already sent stays. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!deleteRequest((await ctx.params).id)) return jsonError(404, "Request not found");
  return Response.json({ ok: true });
}
