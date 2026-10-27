import { jsonError, requireAdmin } from "@/lib/http";
import { UnsupportedMediaError, UploadError } from "@/lib/storage";
import { removeWallImage, setWallImage, WALL_IMAGE_KINDS, WallError, wallToAdmin, type WallImageKind } from "@/lib/walls";
import { wallAndProject } from "../guard";

type Ctx = { params: Promise<{ id: string }> };

function kindOf(req: Request): WallImageKind | null {
  const k = new URL(req.url).searchParams.get("kind");
  return (WALL_IMAGE_KINDS as readonly string[]).includes(k ?? "") ? (k as WallImageKind) : null;
}

/** Uploads the cover or logo (`?kind=cover|logo`, multipart field `image`: PNG, JPEG, WebP or GIF). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const kind = kindOf(req);
  if (!kind) return jsonError(400, "Say which image: kind=cover or kind=logo");
  const found = wallAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Wall not found");
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "Choose an image file");
  try {
    return Response.json({ wall: wallToAdmin(await setWallImage(found.wall.id, kind, file), found.project) });
  } catch (err) {
    if (err instanceof WallError) return jsonError(err.status, err.message);
    if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
    if (err instanceof UploadError) return jsonError(400, err.message);
    throw err;
  }
}

/** Removes the cover or logo and deletes its file unless something else uses it. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const kind = kindOf(req);
  if (!kind) return jsonError(400, "Say which image: kind=cover or kind=logo");
  const found = wallAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Wall not found");
  try {
    return Response.json({ wall: wallToAdmin(await removeWallImage(found.wall.id, kind), found.project) });
  } catch (err) {
    if (err instanceof WallError) return jsonError(err.status, err.message);
    throw err;
  }
}
