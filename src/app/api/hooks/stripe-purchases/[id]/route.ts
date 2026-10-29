import { purchaseHook } from "@/lib/commerce/purchase-hook";

/** INT-07: a project's Stripe webhook (checkout.session.completed, invoice.paid) for the sales popup and "Verified purchase". */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return purchaseHook(req, (await ctx.params).id);
}
