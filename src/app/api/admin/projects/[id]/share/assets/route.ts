import { jsonError, requireRole } from "@/lib/http";
import { SHARE_ASSET_KINDS, type ShareAssetKind } from "@/db/schema";
import { PRIVATE, projectOr404, shareFail } from "@/lib/share/http";
import { addAsset, assetToAdmin, listAssets } from "@/lib/share/store";

type Ctx = { params: Promise<{ id: string }> };

/** The studio's uploaded backgrounds and logos (owner-only). */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = projectOr404((await ctx.params).id);
  if ("response" in found) return found.response;
  return Response.json({ assets: listAssets(found.project.id).map(assetToAdmin) }, { headers: PRIVATE });
}

/** SHARE-01: multipart `file` (PNG or JPEG, sniffed and size-capped) and `kind` (background or logo). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = projectOr404((await ctx.params).id);
  if ("response" in found) return found.response;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "");
  if (!(SHARE_ASSET_KINDS as readonly string[]).includes(kind)) return jsonError(400, "Say whether it's a background or a logo");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "Choose an image file");
  try {
    const asset = await addAsset(found.project.id, kind as ShareAssetKind, file);
    return Response.json({ asset: assetToAdmin(asset) }, { status: 201 });
  } catch (err) {
    return shareFail(err);
  }
}
