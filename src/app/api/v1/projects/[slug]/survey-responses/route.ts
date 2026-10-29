import { apiJson } from "@/lib/api-keys";
import { apiError, listSurveyResponsesPage, pageParams, pagination, projectForKey, requireApiFeature, surveyResponseToApi } from "@/lib/api-v1";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/v1/projects/:slug/survey-responses?formId=&limit=&offset= (L23,
 * NPS-01; flag insights; read only): every answer to an NPS question, newest
 * first, with its 0–10 score, category and comment. Private, like feedback.
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "read", "insights");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const q = new URL(req.url).searchParams;
  const page = pageParams(q);
  if (page instanceof Response) return page;
  const { rows, total } = listSurveyResponsesPage(project.id, { ...page, formId: q.get("formId") });
  return apiJson({ data: rows.map(surveyResponseToApi), pagination: pagination(total, page.limit, page.offset) });
}
