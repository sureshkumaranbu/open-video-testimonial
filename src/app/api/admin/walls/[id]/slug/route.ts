import { z } from "zod";
import { jsonError, requireRole } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { changeWallSlug, WallError, wallToAdmin } from "@/lib/walls";
import { wallAndProject } from "../guard";

const body = z.object({ slug: z.string().max(64) });

/** A new link; the old one keeps working (308). `droppedAlias` warns that another wall's old link stopped working (D17). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const found = wallAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Wall not found");
  try {
    const { wall, droppedAlias } = changeWallSlug(found.wall.id, parsed.data.slug);
    return Response.json({ wall: wallToAdmin(wall, found.project), droppedAlias });
  } catch (err) {
    if (err instanceof WallError) return jsonError(err.status, err.message);
    throw err;
  }
}
