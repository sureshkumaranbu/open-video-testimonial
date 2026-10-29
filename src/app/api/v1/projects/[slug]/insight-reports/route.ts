import { apiJson } from "@/lib/api-keys";
import { apiError, projectForKey, requireApiFeature } from "@/lib/api-v1";
import { listReports, reportToAdmin } from "@/lib/insights/reports";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/insight-reports (L23, VOC-01; flag insights; read only): saved reports, newest first, without their results. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "read", "insights");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  return apiJson({ data: listReports(project.id).map((r) => reportToAdmin(r)) });
}
