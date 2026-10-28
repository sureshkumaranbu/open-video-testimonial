import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { jsonError, requireRole } from "@/lib/http";
import { storage } from "@/lib/storage";
import { getTestimonial } from "@/lib/testimonials";
import { getRender, renderFileName } from "@/lib/video/renders";

/**
 * VID-05, VID-07, VID-08: the finished MP4 as a download, for editors and up
 * (as VID-04's downloads). Never cached outside this browser session.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const r = getRender((await ctx.params).id);
  if (!r || r.kind === "hls") return jsonError(404, "Not found");
  if (r.status !== "ready" || !r.key) return jsonError(409, "It isn't ready yet");
  const label = r.testimonialId
    ? (getTestimonial(r.testimonialId)?.authorName ?? "testimonial")
    : (getDb().select({ name: schema.highlightReels.name }).from(schema.highlightReels).where(eq(schema.highlightReels.id, r.reelId ?? "")).get()?.name ?? "reel");
  const store = storage();
  const stat = await store.stat(r.key);
  const body = stat && (await store.read(r.key));
  if (!stat || !body) return jsonError(404, "The file is missing");
  return new Response(body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${renderFileName(r, label)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
