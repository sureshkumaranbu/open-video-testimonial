import { jsonError, requireAdmin } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";
import { createWall, createWallBody, listWalls, WallError, wallToAdmin } from "@/lib/walls";

type Ctx = { params: Promise<{ id: string }> };

/** WALL-01: the project's walls, oldest first. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ walls: listWalls(project.id).map((w) => wallToAdmin(w, project)) });
}

/** A new wall, as a draft. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createWallBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ wall: wallToAdmin(createWall(project, parsed.data), project) }, { status: 201 });
  } catch (err) {
    if (err instanceof WallError) return jsonError(err.status, err.message);
    throw err;
  }
}
