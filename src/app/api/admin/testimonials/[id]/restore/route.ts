import { auditRequest } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { NoPublicConsentError } from "@/lib/testimonials";
import { NotInTrashError, restoreTestimonial } from "@/lib/trash";

type Ctx = { params: Promise<{ id: string }> };

/** Takes a testimonial out of the trash, back to the status it had (rejected, if its author withdrew). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  let testimonial;
  try {
    testimonial = restoreTestimonial((await ctx.params).id, { by: getRequestSession(req)?.email });
  } catch (err) {
    if (err instanceof NotInTrashError || err instanceof NoPublicConsentError) return jsonError(409, err.message);
    throw err;
  }
  if (!testimonial) return jsonError(404, "Testimonial not found");
  if (testimonial) auditRequest(req, "testimonial.restore", { objectType: "testimonial", objectId: testimonial.id, projectId: testimonial.projectId, summary: testimonial.authorName });
  return Response.json({ testimonial });
}
