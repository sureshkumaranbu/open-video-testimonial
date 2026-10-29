import { auditRequest } from "@/lib/audit";
import { setVerifiedPurchase } from "@/lib/commerce/purchases";
import { featureOn } from "@/lib/features";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getTestimonial } from "@/lib/testimonials";

/**
 * INT-07: `{verified}` removes a testimonial's "Verified purchase" mark, or
 * puts it back (only while a purchase from its email is on record: the mark
 * can't be made up by hand).
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!featureOn("commerce")) return jsonError(404, "Not found");
  const t = getTestimonial((await ctx.params).id);
  if (!t) return jsonError(404, "Testimonial not found");
  const body = await readJsonCapped(req);
  if (body instanceof Response) return body;
  const verified = (body as { verified?: unknown } | null)?.verified;
  if (typeof verified !== "boolean") return jsonError(400, "Send {verified: true|false}");
  if (!setVerifiedPurchase(t, verified)) return jsonError(409, "No purchase from this testimonial's email is on record, so it can't be marked as a verified purchase");
  auditRequest(req, verified ? "testimonial.verified_purchase" : "testimonial.unverified_purchase", {
    objectType: "testimonial",
    objectId: t.id,
    projectId: t.projectId,
    summary: `${verified ? "Marked" : "Unmarked"} ${t.authorName}’s testimonial as a verified purchase`,
  });
  return Response.json({ verifiedPurchaseAt: getTestimonial(t.id)!.verifiedPurchaseAt?.toISOString() ?? null });
}
