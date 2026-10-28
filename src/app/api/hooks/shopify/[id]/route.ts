import { triggerHook } from "@/lib/trigger-hook";

/** REQ-07: a Shopify webhook (orders/fulfilled, orders/paid) for a campaign trigger. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return triggerHook(req, "shopify", (await ctx.params).id);
}
