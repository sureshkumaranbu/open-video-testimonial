import { jsonError, requireAdmin } from "@/lib/http";
import { listCustomers } from "@/lib/customer-records";
import { getProjectById } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string }> };

/** INBOX-12: one page of this project's customers (`?q=&page=`), with their testimonial, feedback and invitation counts. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const sp = new URL(req.url).searchParams;
  const page = Number(sp.get("page"));
  return Response.json(listCustomers(project.id, { q: sp.get("q") ?? "", page: Number.isInteger(page) && page > 0 ? page : 1 }));
}
