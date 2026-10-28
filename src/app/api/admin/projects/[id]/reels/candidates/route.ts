import { jsonError, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { reelCandidates } from "@/lib/video/reels";

/** VID-08: approved, converted video testimonials a reel can use, with their words and times when they have captions. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ testimonials: reelCandidates(project.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
