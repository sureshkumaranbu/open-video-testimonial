import { getRequestSession } from "@/lib/auth";
import { formVideoCaptions } from "@/lib/video/form-videos";

const ID = /^[0-9a-f-]{36}$/;

/** FORM-17: WebVTT captions for the owner's welcome or thank-you video. Public while the form is live; the team can always preview. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const vtt = ID.test(id) ? formVideoCaptions(id, Boolean(getRequestSession(req))) : null;
  if (!vtt) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(vtt, {
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
