import { findByWithdrawToken, withdrawConsent } from "@/lib/consent";
import { jsonError } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getTestimonial } from "@/lib/testimonials";
import { emitTestimonialEvent } from "@/lib/webhooks";

/** The author's private "withdraw my testimonial" action. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!rateLimit(`withdraw:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
    return jsonError(429, "Too many attempts, please try again later");
  }
  const { token } = await ctx.params;
  const row = findByWithdrawToken(token);
  if (!row) return jsonError(404, "This link isn't valid");
  const already = Boolean(row.withdrawnAt);
  withdrawConsent(row.id, { actor: "customer", ip: clientIp(req), detail: "Withdrawn through the author's private link" });
  if (!already) emitTestimonialEvent("consent.withdrawn", getTestimonial(row.id));
  return Response.json({ ok: true, alreadyWithdrawn: already });
}
