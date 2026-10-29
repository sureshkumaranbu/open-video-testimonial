import { auditRequest } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { insightsErrorResponse } from "@/lib/insights/http";
import { listReports, reportToAdmin, saveReport } from "@/lib/insights/reports";
import { getProjectById } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string }> };

/** VOC-01: the project's saved reports, newest first. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ reports: listReports(project.id).map((r) => reportToAdmin(r)) }, { headers: { "Cache-Control": "private, no-store" } });
}

/** VOC-01: saves a report as shown `{kind: voc|ask|nps, name, params, result}`. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const body = await readJsonCapped(req, 600 * 1024);
  if (body instanceof Response) return body;
  try {
    const report = saveReport(project.id, body, getRequestSession(req)?.email);
    auditRequest(req, "insights.report_save", { objectType: "insight_report", objectId: report.id, projectId: project.id, summary: `Saved the ${report.kind.toUpperCase()} report “${report.name}”` });
    return Response.json({ report: reportToAdmin(report) }, { status: 201 });
  } catch (err) {
    return insightsErrorResponse(err);
  }
}
