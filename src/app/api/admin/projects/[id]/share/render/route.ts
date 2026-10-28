import { z } from "zod";
import { jsonError, requireRole } from "@/lib/http";
import { designSize, renderSpecSchema, SHARE_FORMATS } from "@/lib/share/design";
import { imageName, PRIVATE, projectOr404, shareFail } from "@/lib/share/http";
import { renderShare } from "@/lib/share/render";
import { firstIssue } from "@/lib/validation";

const body = renderSpecSchema.extend({ format: z.enum(SHARE_FORMATS).default("png"), download: z.boolean().default(false) });

/**
 * SHARE-01: draws one image on the server (the studio's preview and its
 * downloads): `{design, items: [{id, text?, name?, byline?}], format, download}`.
 * The overrides are for this image only; the testimonials don't change.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = projectOr404((await ctx.params).id);
  if ("response" in found) return found.response;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { format, download, ...spec } = parsed.data;
  try {
    const out = await renderShare(spec, { project: found.project }, format);
    const name = imageName(spec.design.template, designSize(spec.design), out.ext);
    return new Response(Buffer.from(out.bytes), {
      headers: { ...PRIVATE, "Content-Type": out.mime, "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"` },
    });
  } catch (err) {
    return shareFail(err);
  }
}
