import { getRequestSession } from "@/lib/auth";
import { getTestimonial } from "@/lib/testimonials";

/** WebVTT captions for a video. Public once approved; the owner can always preview. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = /^[0-9a-f-]{36}$/.test(id) ? getTestimonial(id) : null;
  const visible = t?.captionsVtt && (t.status === "approved" || getRequestSession(req));
  if (!t || !visible) return new Response("Not found", { status: 404 });
  return new Response(t.captionsVtt, {
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
