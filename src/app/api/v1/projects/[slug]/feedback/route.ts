import { apiJson } from "@/lib/api-keys";
import { apiError, feedbackToApi, listFeedbackPage, pageParams, pagination, projectForKey, requireApi2 } from "@/lib/api-v1";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/feedback?limit=&offset= (API-01, read): private feedback (low ratings and private questions), newest first. It's never published. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const page = pageParams(new URL(req.url).searchParams);
  if (page instanceof Response) return page;
  const { rows, total } = listFeedbackPage(project.id, page);
  return apiJson({ data: rows.map(feedbackToApi), pagination: pagination(total, page.limit, page.offset) });
}
