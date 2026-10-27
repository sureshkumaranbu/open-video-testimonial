import { jsonError, requireAdmin } from "@/lib/http";
import { storage } from "@/lib/storage";
import { getTestimonial } from "@/lib/testimonials";
import { DOWNLOADS, downloadFor, type DownloadKind } from "@/lib/video-tools";

/**
 * VID-04: `?file=original` (as uploaded) or `?file=mp4` (the converted video,
 * the cut when trimmed), for the signed-in owner only. Sent as an attachment
 * and never cached by anything but this browser session.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const kind = new URL(req.url).searchParams.get("file") ?? "mp4";
  if (!(DOWNLOADS as readonly string[]).includes(kind)) return jsonError(400, "Choose file=original or file=mp4");
  const t = getTestimonial((await ctx.params).id);
  if (!t) return jsonError(404, "Testimonial not found");
  const file = downloadFor(t, kind as DownloadKind);
  if (!file) return jsonError(404, kind === "mp4" ? "There's no converted MP4 yet" : "This testimonial has no video");
  const store = storage();
  const stat = await store.stat(file.key);
  const body = stat && (await store.read(file.key));
  if (!stat || !body) return jsonError(404, "The file is missing");
  return new Response(body, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${file.name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
