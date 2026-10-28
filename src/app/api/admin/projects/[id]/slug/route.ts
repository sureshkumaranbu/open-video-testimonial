import { auditRequest } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { changeProjectSlug, checkSlug, ProjectError } from "@/lib/projects";
import { getProjectById } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string }> };

/** Whether the project can take ?slug=, and whose old links it would replace (the dashboard warns before the change). */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getProjectById(id)) return jsonError(404, "Project not found");
  return Response.json(checkSlug(new URL(req.url).searchParams.get("slug") ?? "", id));
}

/** Changes the project's link. The old slug keeps working as a redirect (D17). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { slug?: unknown } | null;
  if (typeof body?.slug !== "string") return jsonError(400, "Send the new link as slug");
  if (!getProjectById(id)) return jsonError(404, "Project not found");
  const check = checkSlug(body.slug, id);
  try {
    const project = changeProjectSlug(id, body.slug);
    auditRequest(req, "project.slug", { objectType: "project", objectId: id, projectId: id, summary: project.slug });
    return Response.json({
      project,
      ...(check.replacesAliasOf
        ? { warning: `“${check.slug}” was an old link of ${check.replacesAliasOf.name}. Those links now open this project.` }
        : {}),
    });
  } catch (err) {
    if (err instanceof ProjectError) return jsonError(err.status, err.message);
    throw err;
  }
}
