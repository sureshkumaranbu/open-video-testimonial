import { jsonError, requireRole } from "@/lib/http";
import { listImportRuns } from "@/lib/importers/run";
import { getProjectById } from "@/lib/testimonials";

/** This project's recent imports from review sites and other tools, newest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ runs: listImportRuns(project.id) });
}
