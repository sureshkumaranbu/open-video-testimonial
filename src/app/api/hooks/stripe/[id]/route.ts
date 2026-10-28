import { triggerHook } from "@/lib/trigger-hook";

/** REQ-07: a Stripe webhook (checkout.session.completed, invoice.paid) for a campaign trigger. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return triggerHook(req, "stripe", (await ctx.params).id);
}
