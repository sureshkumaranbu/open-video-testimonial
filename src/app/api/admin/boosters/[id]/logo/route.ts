import { boosterToAdmin, removeBoosterLogo, setBoosterLogo } from "@/lib/boosters";
import { jsonError, requireAdmin } from "@/lib/http";
import { UnsupportedMediaError, UploadError } from "@/lib/storage";
import { boosterAndProject, boosterError } from "../guard";

type Ctx = { params: Promise<{ id: string }> };

/** Uploads the page's own logo (multipart field `image`: PNG, JPEG, WebP or GIF). Without one, the project's logo shows. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const found = boosterAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Booster not found");
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "Choose an image file");
  try {
    return Response.json({ booster: boosterToAdmin(await setBoosterLogo(found.booster.id, file), found.project) });
  } catch (err) {
    if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
    if (err instanceof UploadError) return jsonError(400, err.message);
    return boosterError(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const found = boosterAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Booster not found");
  try {
    return Response.json({ booster: boosterToAdmin(await removeBoosterLogo(found.booster.id), found.project) });
  } catch (err) {
    return boosterError(err);
  }
}
