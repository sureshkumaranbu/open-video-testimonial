import { auditRequest } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { getReport, reportCsv } from "@/lib/insights/reports";

/** VOC-01: a saved report as CSV. Exports need an editor, like every other export (TEAM-01). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const report = getReport((await ctx.params).id);
  if (!report) return jsonError(404, "Report not found");
  auditRequest(req, "insights.report_export", { objectType: "insight_report", objectId: report.id, projectId: report.projectId, summary: `Exported the report “${report.name}”` });
  const name = report.name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60).toLowerCase() || "report";
  return new Response(reportCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plaudit-${report.kind}-${name}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
