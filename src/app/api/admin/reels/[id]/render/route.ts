import { auditRequest } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { requireRole } from "@/lib/http";
import { renderErrorResponse } from "@/lib/video/http";
import { renderToAdmin, requestReelRender } from "@/lib/video/renders";

/** VID-08: renders the reel as it's saved now (in the background); poll GET /api/admin/renders/<id>. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const render = await requestReelRender(id, { by: getRequestSession(req)?.email });
    auditRequest(req, "reel.render", { objectType: "reel", objectId: id, projectId: render.projectId, summary: "Rendered a highlight reel" });
    return Response.json({ render: renderToAdmin(render) }, { status: 202 });
  } catch (err) {
    return renderErrorResponse(err);
  }
}
