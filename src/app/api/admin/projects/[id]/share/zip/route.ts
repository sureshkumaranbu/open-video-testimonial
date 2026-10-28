import { z } from "zod";
import { jsonError, requireRole } from "@/lib/http";
import { designSize, MAX_ZIP_IMAGES, renderSpecSchema, SHARE_FORMATS } from "@/lib/share/design";
import { imageName, PRIVATE, projectOr404, shareFail } from "@/lib/share/http";
import { renderShare } from "@/lib/share/render";
import { firstIssue } from "@/lib/validation";
import { zipStream, type ZipSource } from "@/lib/zip";

const body = z.object({
  renders: z.array(renderSpecSchema).min(1, "Choose at least one image").max(MAX_ZIP_IMAGES, `A ZIP holds up to ${MAX_ZIP_IMAGES} images`),
  format: z.enum(SHARE_FORMATS).default("png"),
});

/** SHARE-01: several images (sizes, or one per testimonial) in one ZIP, using the ZIP writer the export already has. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = projectOr404((await ctx.params).id);
  if ("response" in found) return found.response;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const entries: ZipSource[] = [];
  const names = new Set<string>();
  try {
    for (const [i, spec] of parsed.data.renders.entries()) {
      const out = await renderShare(spec, { project: found.project }, parsed.data.format);
      let name = imageName(spec.design.template, designSize(spec.design), out.ext);
      if (names.has(name)) name = imageName(spec.design.template, designSize(spec.design), out.ext, i + 1);
      names.add(name);
      entries.push({ name, data: out.bytes });
    }
  } catch (err) {
    return shareFail(err);
  }
  const chunks: Uint8Array[] = [];
  for await (const c of zipStream(entries)) chunks.push(c);
  return new Response(Buffer.concat(chunks), {
    headers: { ...PRIVATE, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="testimonial-images.zip"` },
  });
}
