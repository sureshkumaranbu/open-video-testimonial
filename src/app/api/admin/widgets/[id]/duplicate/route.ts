import { jsonError, requireRole } from "@/lib/http";
import { duplicateWidget, widgetToAdmin } from "@/lib/widgets";

/** A copy with a new id, named "… (copy)". */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const w = duplicateWidget((await ctx.params).id);
  if (!w) return jsonError(404, "Widget not found");
  return Response.json({ widget: widgetToAdmin(w) }, { status: 201 });
}
