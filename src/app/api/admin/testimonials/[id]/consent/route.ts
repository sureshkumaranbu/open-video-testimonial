import { listConsentEvents, parseScopes } from "@/lib/consent";
import { jsonError, requireRole } from "@/lib/http";
import { getTestimonial } from "@/lib/testimonials";

/** The consent record for one testimonial: scopes and the full event history. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const { id } = await ctx.params;
  const t = getTestimonial(id);
  if (!t) return jsonError(404, "Testimonial not found");
  return Response.json({
    consentAt: t.consentAt,
    scopes: parseScopes(t.consentScopes),
    editedAfterConsent: t.editedAfterConsent,
    withdrawnAt: t.withdrawnAt,
    events: listConsentEvents(id).map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor,
      at: e.createdAt,
      text: e.text,
      textHash: e.textHash,
      scopes: e.scopes ? parseScopes(e.scopes) : null,
      ipHash: e.ipHash,
      detail: e.detail,
    })),
  });
}
