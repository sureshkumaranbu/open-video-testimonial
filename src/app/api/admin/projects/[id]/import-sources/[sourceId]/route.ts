import { jsonError, readJsonCapped, requireAdmin } from "@/lib/http";
import { deleteSyncSource, SyncError, syncPatchSchema, toSyncJson, updateSyncSource } from "@/lib/importers/sync";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string; sourceId: string }> };

/** Pause or resume a synced source, or change its interval or options. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id, sourceId } = await ctx.params;
  const project = getProjectById(id);
  if (!project) return jsonError(404, "Project not found");
  const raw = await readJsonCapped(req, 8192);
  if (raw instanceof Response) return raw;
  const parsed = syncPatchSchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ source: toSyncJson(updateSyncSource(project.id, sourceId, parsed.data)) });
  } catch (err) {
    if (err instanceof SyncError) return jsonError(err.status, err.message);
    throw err;
  }
}

/** Stops syncing this source. What it imported stays. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id, sourceId } = await ctx.params;
  const project = getProjectById(id);
  if (!project) return jsonError(404, "Project not found");
  if (!deleteSyncSource(project.id, sourceId)) return jsonError(404, "Synced source not found");
  return new Response(null, { status: 204 });
}
