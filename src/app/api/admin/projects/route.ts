import { jsonError, requireAdmin } from "@/lib/http";
import { createProject, getProjectBySlug, listProjects } from "@/lib/testimonials";
import { firstIssue, projectSchema } from "@/lib/validation";

export function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return Response.json({ projects: listProjects() });
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = projectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (getProjectBySlug(parsed.data.slug)) return jsonError(409, "That slug is already taken");
  return Response.json({ project: createProject(parsed.data) }, { status: 201 });
}
