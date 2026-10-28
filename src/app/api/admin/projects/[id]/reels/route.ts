import { auditRequest } from "@/lib/audit";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { renderErrorResponse } from "@/lib/video/http";
import { createReel, listReels, reelToAdmin } from "@/lib/video/reels";

type Ctx = { params: Promise<{ id: string }> };

/** VID-08: the project's highlight reels, newest change first, each with its renders. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ reels: listReels(project.id).map(reelToAdmin) }, { headers: { "Cache-Control": "private, no-store" } });
}

/** VID-08: a new reel `{name, config}` (src/lib/video/reel-config.ts). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const input = await readJsonCapped(req);
  if (input instanceof Response) return input;
  try {
    const reel = createReel(project.id, input);
    auditRequest(req, "reel.create", { objectType: "reel", objectId: reel.id, projectId: project.id, summary: `Made the highlight reel “${reel.name}”` });
    return Response.json({ reel: reelToAdmin(reel) }, { status: 201 });
  } catch (err) {
    return renderErrorResponse(err);
  }
}
