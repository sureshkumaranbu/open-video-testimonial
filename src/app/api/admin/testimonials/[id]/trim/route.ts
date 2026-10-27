import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { setTrim, trimInfo, VideoToolError } from "@/lib/video-tools";

type Ctx = { params: Promise<{ id: string }> };

/** At most a day, in whole milliseconds; null = from the start / to the end. */
const ms = z.number().int("Trim points must be whole milliseconds").min(0).max(86_400_000).nullable();
const body = z.object({ startMs: ms, endMs: ms });

const fail = (err: unknown) => {
  if (err instanceof VideoToolError) return jsonError(err.status, err.message);
  throw err;
};

/** VID-01: the original's length, waveform peaks and the current trim, for the trim tool. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    return Response.json(await trimInfo((await ctx.params).id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return fail(err);
  }
}

/** VID-01: keep {startMs, endMs} of the original (both null = the whole video). The MP4 is re-cut in the background. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const testimonial = await setTrim((await ctx.params).id, parsed.data, { by: getRequestSession(req)?.email });
    return Response.json({ testimonial });
  } catch (err) {
    return fail(err);
  }
}
