import { z } from "zod";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { getWall, setMainWall, WallError, wallToAdmin } from "@/lib/walls";
import { wallAndProject } from "../guard";

const body = z.object({ main: z.boolean() });

/** Makes this the project's main wall (shown at /wall/<project> while published), or stops it being main. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const found = wallAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Wall not found");
  try {
    if (parsed.data.main) setMainWall(found.project.id, found.wall.id);
    else if (found.wall.isMain) setMainWall(found.project.id, null);
    return Response.json({ wall: wallToAdmin(getWall(found.wall.id)!, found.project) });
  } catch (err) {
    if (err instanceof WallError) return jsonError(err.status, err.message);
    throw err;
  }
}
