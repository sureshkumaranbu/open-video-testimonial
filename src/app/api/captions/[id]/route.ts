import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getRequestSession } from "@/lib/auth";
import { trimVtt } from "@/lib/captions";
import { trimOf } from "@/lib/media";
import { getTestimonial } from "@/lib/testimonials";

const ID = /^[0-9a-f-]{36}$/;

const vtt = (body: string, cors: boolean) =>
  new Response(body, {
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "no-cache",
      ...(cors ? { "Access-Control-Allow-Origin": "*" } : {}),
      "X-Content-Type-Options": "nosniff",
    },
  });

/**
 * WebVTT captions for a video. Public once approved; the owner can always
 * preview. A trimmed video gets its captions cut and shifted to match (VID-01). `?answer=<id>` is the video answering a further question: those
 * are owner-only (D13), so it always needs a session.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const answerId = new URL(req.url).searchParams.get("answer");
  if (answerId !== null) {
    if (!ID.test(id) || !ID.test(answerId) || !getRequestSession(req)) return new Response("Not found", { status: 404 });
    const { answers } = schema;
    const a = getDb()
      .select({ captionsVtt: answers.captionsVtt })
      .from(answers)
      .where(and(eq(answers.id, answerId), eq(answers.testimonialId, id)))
      .get();
    if (!a?.captionsVtt) return new Response("Not found", { status: 404 });
    return vtt(a.captionsVtt, false);
  }
  const t = ID.test(id) ? getTestimonial(id) : null;
  const visible = t?.captionsVtt && (t.status === "approved" || getRequestSession(req));
  if (!t || !visible) return new Response("Not found", { status: 404 });
  return vtt(trimVtt(t.captionsVtt!, trimOf(t)), true);
}
