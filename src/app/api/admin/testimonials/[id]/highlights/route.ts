import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { HighlightError, MAX_HIGHLIGHTS, setHighlights } from "@/lib/highlights";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  highlights: z
    .array(
      z.object({
        answerId: z.string().min(1).max(64).nullable(),
        start: z.number().int().min(0),
        end: z.number().int().min(1),
      }),
    )
    .max(MAX_HIGHLIGHTS),
});

/** Replaces the testimonial's highlighted phrases (INBOX-08). `answerId: null` is the main text. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const highlights = setHighlights((await ctx.params).id, parsed.data.highlights, { by: getRequestSession(req)?.email });
    if (!highlights) return jsonError(404, "Testimonial not found");
    return Response.json({ highlights });
  } catch (err) {
    if (err instanceof HighlightError) return jsonError(400, err.message);
    throw err;
  }
}
