import { apiJson } from "@/lib/api-keys";
import { apiError, projectOfRow, requireApiFeature } from "@/lib/api-v1";
import { getReport, reportToAdmin } from "@/lib/insights/reports";

/** GET /api/v1/insight-reports/:id (L23, VOC-01; flag insights; read only): a saved report with its result, as it was when saved. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireApiFeature(req, "read", "insights");
  if (auth.error) return auth.error;
  const r = getReport((await ctx.params).id);
  if (!r || !projectOfRow(auth.key, r)) return apiError(404, "Report not found");
  return apiJson({ data: reportToAdmin(r, { full: true }) });
}
