import { auditRequest } from "@/lib/audit";
import { deletePurchases } from "@/lib/commerce/purchases";
import { featureOn } from "@/lib/features";
import { jsonError, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";

/** INT-07: deletes every purchase recorded for the project, now; the connection stays. Admins only. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  if (!featureOn("commerce")) return jsonError(404, "Not found");
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const removed = deletePurchases(project.id);
  auditRequest(req, "purchase.delete_all", { objectType: "project", objectId: project.id, projectId: project.id, summary: `Deleted ${removed} recorded purchase${removed === 1 ? "" : "s"}` });
  return Response.json({ removed });
}
