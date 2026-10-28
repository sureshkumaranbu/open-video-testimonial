import { auditRequest } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { trashTestimonial } from "@/lib/trash";

type Ctx = { params: Promise<{ id: string }> };

/** Moves a testimonial to the trash: off every public page, restorable until it's purged. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const testimonial = trashTestimonial((await ctx.params).id, { by: getRequestSession(req)?.email });
  if (!testimonial) return jsonError(404, "Testimonial not found");
  auditRequest(req, "testimonial.trash", { objectType: "testimonial", objectId: testimonial.id, projectId: testimonial.projectId, summary: testimonial.authorName });
  return Response.json({ testimonial });
}
