import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { deleteWall, updateWall, WallError, wallPatchBody, wallToAdmin, type WallConfigInput } from "@/lib/walls";
import { wallAndProject } from "./guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = wallAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Wall not found");
  return Response.json({ wall: wallToAdmin(found.wall, found.project) });
}

/** Name, theme, draft or published, featured testimonial, connected form, and the whole config. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = wallPatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const found = wallAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Wall not found");
  const { config, ...rest } = parsed.data;
  try {
    const w = updateWall(found.wall.id, { ...rest, config: config as WallConfigInput | undefined });
    if (!w) return jsonError(404, "Wall not found");
    return Response.json({ wall: wallToAdmin(w, found.project) });
  } catch (err) {
    if (err instanceof WallError) return jsonError(err.status, err.message);
    throw err;
  }
}

/** Deletes the wall; if it was the main wall, the project's wall address shows the classic page again. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!(await deleteWall((await ctx.params).id))) return jsonError(404, "Wall not found");
  return Response.json({ ok: true });
}
