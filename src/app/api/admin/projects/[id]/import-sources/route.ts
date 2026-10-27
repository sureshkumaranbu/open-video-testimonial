import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, readJsonCapped, requireAdmin } from "@/lib/http";
import { createSyncSource, intervalSchema, listSyncSources, SyncError, toSyncJson } from "@/lib/importers/sync";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** IMP-02: this project's automatically synced sources, with their last run and the next one. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ sources: listSyncSources(project.id).map(toSyncJson) });
}

const body = z.object({ runId: z.string().min(1).max(64), intervalHours: intervalSchema.default(24) });

/** "Keep this in sync": the finished import `runId` again every 12 or 24 hours. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const raw = await readJsonCapped(req, 4096);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const s = createSyncSource(project.id, parsed.data.runId, parsed.data.intervalHours, { by: getRequestSession(req)?.email });
    return Response.json({ source: toSyncJson(s) }, { status: 201 });
  } catch (err) {
    if (err instanceof SyncError) return jsonError(err.status, err.message);
    throw err;
  }
}
