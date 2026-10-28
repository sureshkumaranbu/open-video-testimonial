import { auditRequest } from "@/lib/audit";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { renderErrorResponse } from "@/lib/video/http";
import { deleteReel, getReel, reelToAdmin, updateReel } from "@/lib/video/reels";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const reel = getReel((await ctx.params).id);
  if (!reel) return jsonError(404, "Reel not found");
  return Response.json({ reel: reelToAdmin(reel) }, { headers: { "Cache-Control": "private, no-store" } });
}

/** VID-08: saves the reel `{name, config}`; its renders stay as they were made. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const input = await readJsonCapped(req);
  if (input instanceof Response) return input;
  try {
    const reel = updateReel((await ctx.params).id, input);
    if (!reel) return jsonError(404, "Reel not found");
    auditRequest(req, "reel.update", { objectType: "reel", objectId: reel.id, projectId: reel.projectId, summary: `Changed the highlight reel “${reel.name}”` });
    return Response.json({ reel: reelToAdmin(reel) });
  } catch (err) {
    return renderErrorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const reel = getReel((await ctx.params).id);
  if (!reel) return jsonError(404, "Reel not found");
  try {
    await deleteReel(reel.id);
  } catch (err) {
    return renderErrorResponse(err);
  }
  auditRequest(req, "reel.delete", { objectType: "reel", objectId: reel.id, projectId: reel.projectId, summary: `Deleted the highlight reel “${reel.name}”` });
  return new Response(null, { status: 204 });
}
