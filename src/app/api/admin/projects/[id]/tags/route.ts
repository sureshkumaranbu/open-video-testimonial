import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { deleteTag, listTagUsage, mergeTags, ProjectError, renameTag, tagDeleteBody as deleteSchema, tagsPatchBody as patchSchema } from "@/lib/projects";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Runs a tags change, then answers with the project's tags as they now are. */
function apply(projectId: string, change: () => void) {
  try {
    change();
  } catch (err) {
    if (err instanceof ProjectError) return jsonError(err.status, err.message);
    throw err;
  }
  return Response.json({ tags: listTagUsage(projectId) });
}

/** The project's tags, with how many testimonials have each. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getProjectById(id)) return jsonError(404, "Project not found");
  return Response.json({ tags: listTagUsage(id) });
}

/** `{action: "rename", from, to}` or `{action: "merge", from: […], into}`, on every testimonial at once. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getProjectById(id)) return jsonError(404, "Project not found");
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const by = getRequestSession(req)?.email;
  const c = parsed.data;
  return apply(id, () => (c.action === "rename" ? renameTag(id, c.from, c.to, { by }) : mergeTags(id, c.from, c.into, { by })));
}

/** `{name}`: removes the tag from every testimonial and from the project. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getProjectById(id)) return jsonError(404, "Project not found");
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  return apply(id, () => deleteTag(id, parsed.data.name, { by: getRequestSession(req)?.email }));
}
