import { dismissRemoved } from "@/lib/analytics";
import { jsonError, requireRole } from "@/lib/http";
import { getWidget } from "@/lib/widgets";

/** DISP-13: hides the "removed from your site" alert; it comes back if the widget goes missing again later. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getWidget(id)) return jsonError(404, "Widget not found");
  dismissRemoved(id);
  return Response.json({ ok: true });
}
