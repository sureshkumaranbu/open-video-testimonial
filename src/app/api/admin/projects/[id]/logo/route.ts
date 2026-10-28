import { jsonError, requireRole } from "@/lib/http";
import { ProjectError, removeProjectLogo, setProjectLogo } from "@/lib/projects";
import { UnsupportedMediaError, UploadError } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Uploads the project's logo (multipart field `logo`: PNG, JPEG, WebP or GIF), replacing the old one. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "Choose an image file for the logo");
  try {
    return Response.json({ project: await setProjectLogo(id, file) });
  } catch (err) {
    if (err instanceof ProjectError) return jsonError(err.status, err.message);
    if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
    if (err instanceof UploadError) return jsonError(400, err.message);
    throw err;
  }
}

/** Removes the logo and deletes its file. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  try {
    return Response.json({ project: await removeProjectLogo((await ctx.params).id) });
  } catch (err) {
    if (err instanceof ProjectError) return jsonError(err.status, err.message);
    throw err;
  }
}
