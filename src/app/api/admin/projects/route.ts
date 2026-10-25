import { jsonError, requireAdmin } from "@/lib/http";
import { createProjectClaimingSlug, ProjectError } from "@/lib/projects";
import { listProjects } from "@/lib/testimonials";
import { firstIssue, projectSchema } from "@/lib/validation";

export function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return Response.json({ projects: listProjects() });
}

/** Creates a project. A slug that's only another project's old link is taken over (D17), with a warning saying whose. */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = projectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const { project, replacedAliasOf } = createProjectClaimingSlug(parsed.data);
    return Response.json(
      {
        project,
        ...(replacedAliasOf
          ? { warning: `“${project.slug}” was an old link of ${replacedAliasOf.name}. Those links now open ${project.name}.` }
          : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    // Keeps the message older clients and tests know.
    if (err instanceof ProjectError && err.status === 409) return jsonError(409, "That slug is already taken");
    if (err instanceof ProjectError) return jsonError(err.status, err.message);
    throw err;
  }
}
