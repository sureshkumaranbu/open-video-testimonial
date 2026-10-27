import { analyticsUi, dashboardReport, parseRange } from "@/lib/analytics";
import { jsonError, requireAdmin } from "@/lib/http";
import { listProjects } from "@/lib/testimonials";

/**
 * AN-01: the dashboard's numbers for `?from=YYYY-MM-DD&to=YYYY-MM-DD`
 * (default the last 30 days) and `?project=<id>` (default every project),
 * with the period just before to compare.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!analyticsUi()) return jsonError(404, "Analytics is switched off on this server");
  const q = new URL(req.url).searchParams;
  const all = listProjects();
  const project = q.get("project");
  const ids = project && project !== "all" ? all.filter((p) => p.id === project).map((p) => p.id) : all.map((p) => p.id);
  if (project && project !== "all" && !ids.length) return jsonError(404, "Project not found");
  return Response.json({ report: dashboardReport(ids, parseRange(q.get("from"), q.get("to"))) });
}
