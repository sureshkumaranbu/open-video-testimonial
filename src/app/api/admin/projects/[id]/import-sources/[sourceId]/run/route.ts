import { jsonError, requireRole } from "@/lib/http";
import { getSyncSource, startSyncRun, toSyncJson } from "@/lib/importers/sync";
import { getProjectById } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string; sourceId: string }> };

/** "Run now": one run of a synced source straight away (a run already going is left to finish). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, sourceId } = await ctx.params;
  const project = getProjectById(id);
  if (!project) return jsonError(404, "Project not found");
  const s = getSyncSource(project.id, sourceId);
  if (!s) return jsonError(404, "Synced source not found");
  const run = startSyncRun(s);
  return Response.json({ runId: run.id, source: toSyncJson(getSyncSource(project.id, sourceId)!) }, { status: 202 });
}
