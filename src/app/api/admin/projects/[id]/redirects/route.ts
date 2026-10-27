import { jsonError, requireAdmin } from "@/lib/http";
import { listRedirects } from "@/lib/projects";
import { getProjectById } from "@/lib/testimonials";

/** The old links that still lead to this project, its forms and its walls. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getProjectById(id)) return jsonError(404, "Project not found");
  return Response.json({ redirects: listRedirects(id) });
}
