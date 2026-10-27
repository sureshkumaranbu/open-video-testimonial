import { jsonError, requireAdmin, requireOwner } from "@/lib/http";
import { deleteProject, ProjectError } from "@/lib/projects";
import { parseReminderDays } from "@/lib/requests";
import { getProjectById, listTestimonials, updateProject } from "@/lib/testimonials";
import { firstIssue, projectUpdateSchema } from "@/lib/validation";
import { TESTIMONIAL_STATUSES, type TestimonialStatus } from "@/db/schema";

type Ctx = { params: Promise<{ id: string }> };

/** Project details plus its testimonials (all statuses, private fields included). */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const project = getProjectById(id);
  if (!project) return jsonError(404, "Project not found");
  const status = new URL(req.url).searchParams.get("status");
  const filter = TESTIMONIAL_STATUSES.includes(status as TestimonialStatus)
    ? (status as TestimonialStatus)
    : undefined;
  return Response.json({ project, testimonials: listTestimonials(id, { status: filter }) });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const parsed = projectUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const patch = { ...parsed.data };
  if (patch.reminderDays !== undefined) patch.reminderDays = parseReminderDays(patch.reminderDays).join(", ");
  const project = updateProject(id, patch);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ project });
}

/**
 * Deletes the project, its testimonials and every file, for good. Only the
 * owner may, and the body must carry the project's name: `{confirm: <name>}`.
 */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireOwner(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  const confirm = typeof body?.confirm === "string" ? body.confirm : "";
  try {
    const result = await deleteProject(id, { confirm });
    if (!result) return jsonError(404, "Project not found");
    return Response.json({ deleted: true, files: result.files });
  } catch (err) {
    if (err instanceof ProjectError) return jsonError(err.status, err.message);
    throw err;
  }
}
