import { auditRequest } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { renderErrorResponse } from "@/lib/video/http";
import { deleteRender, getRender, renderToAdmin } from "@/lib/video/renders";

type Ctx = { params: Promise<{ id: string }> };

/** A multiclip, social clip or reel render: its state (queued, processing, ready or failed with why). */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const r = getRender((await ctx.params).id);
  if (!r || r.kind === "hls") return jsonError(404, "Not found");
  return Response.json({ render: renderToAdmin(r) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const r = getRender(id);
  try {
    if (!(await deleteRender(id))) return jsonError(404, "Not found");
  } catch (err) {
    return renderErrorResponse(err);
  }
  auditRequest(req, "video.render_delete", { objectType: "render", objectId: id, projectId: r?.projectId, summary: `Deleted a ${r?.kind ?? "render"}` });
  return new Response(null, { status: 204 });
}
