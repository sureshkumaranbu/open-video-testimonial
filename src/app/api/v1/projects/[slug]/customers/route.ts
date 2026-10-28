import { apiJson } from "@/lib/api-keys";
import { apiError, customerToApi, listCustomers, pageParams, pagination, projectForKey, requireApi2 } from "@/lib/api-v1";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/customers?email=&limit=&offset= (API-01, read): the people behind the testimonials, by name. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApi2(req, "read");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const q = new URL(req.url).searchParams;
  const page = pageParams(q);
  if (page instanceof Response) return page;
  const email = q.get("email");
  if (email && email.length > 254) return apiError(400, "email is too long");
  const { rows, total } = listCustomers(project.id, { ...page, email });
  return apiJson({ data: rows.map(customerToApi), pagination: pagination(total, page.limit, page.offset) });
}
