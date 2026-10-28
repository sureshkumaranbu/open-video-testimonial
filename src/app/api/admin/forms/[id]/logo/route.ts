import { removeFormLogo, setFormLogo } from "@/lib/forms/admin";
import { jsonError, requireRole } from "@/lib/http";
import { UnsupportedMediaError, UploadError } from "@/lib/storage";
import { formErrorResponse, formResponse } from "../shared";

type Ctx = { params: Promise<{ id: string }> };

/** Uploads the form's logo (multipart field `logo`: PNG, JPEG, WebP or GIF; checked by its bytes, never SVG). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  const data = await req.formData().catch(() => null);
  const file = data?.get("logo");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "Choose an image file for the logo");
  try {
    await setFormLogo(id, file);
  } catch (err) {
    if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
    if (err instanceof UploadError) return jsonError(400, err.message);
    return formErrorResponse(err);
  }
  return formResponse(id);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    await removeFormLogo(id);
  } catch (err) {
    return formErrorResponse(err);
  }
  return formResponse(id);
}
