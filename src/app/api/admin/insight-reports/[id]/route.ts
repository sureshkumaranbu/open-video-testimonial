import { auditRequest } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { deleteReport, getReport, reportToAdmin } from "@/lib/insights/reports";

type Ctx = { params: Promise<{ id: string }> };

/** VOC-01: one saved report, with what it found. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const report = getReport((await ctx.params).id);
  if (!report) return jsonError(404, "Report not found");
  return Response.json({ report: reportToAdmin(report, { full: true }) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const report = getReport((await ctx.params).id);
  if (!report) return jsonError(404, "Report not found");
  deleteReport(report.id);
  auditRequest(req, "insights.report_delete", { objectType: "insight_report", objectId: report.id, projectId: report.projectId, summary: `Deleted the report “${report.name}”` });
  return new Response(null, { status: 204 });
}
