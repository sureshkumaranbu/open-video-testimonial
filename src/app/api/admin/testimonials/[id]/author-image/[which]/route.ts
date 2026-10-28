import { getRequestSession } from "@/lib/auth";
import { isAuthorImage, setAuthorImage } from "@/lib/author-images";
import { jsonError, requireRole } from "@/lib/http";
import { UnsupportedMediaError, UploadError } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; which: string }> };

const NAMES = { avatar: "photo", logo: "company logo" } as const;

/** Uploads the person's photo (`…/avatar`) or company logo (`…/logo`): multipart field `file`, PNG, JPEG, WebP or GIF. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, which } = await ctx.params;
  if (!isAuthorImage(which)) return jsonError(404, "Not found");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, `Choose an image file for the ${NAMES[which]}`);
  try {
    const testimonial = await setAuthorImage(id, which, file, { by: getRequestSession(req)?.email });
    if (!testimonial) return jsonError(404, "Testimonial not found");
    return Response.json({ testimonial });
  } catch (err) {
    if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
    if (err instanceof UploadError) return jsonError(400, err.message);
    throw err;
  }
}

/** Removes the photo or logo and deletes its file. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const { id, which } = await ctx.params;
  if (!isAuthorImage(which)) return jsonError(404, "Not found");
  const testimonial = await setAuthorImage(id, which, null, { by: getRequestSession(req)?.email });
  if (!testimonial) return jsonError(404, "Testimonial not found");
  return Response.json({ testimonial });
}
