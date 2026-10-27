import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, readJsonCapped, requireAdmin } from "@/lib/http";
import { MergeError, mergeTestimonials } from "@/lib/merge";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";
// Registers the notifications listener in this route's bundle.
import "@/lib/notifications";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  /** The testimonial that goes to the trash once its content is copied. */
  from: z.string().min(1).max(64),
  /** The one that keeps both. */
  into: z.string().min(1).max(64),
});

/**
 * INBOX-11 "Merge into…": `from`'s main answer and other answers become extra
 * answers on `into`, tags and images join, and `from` goes to the trash.
 * Both must be in this project; withdrawn ones are refused (409).
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const raw = await readJsonCapped(req, 4096);
  if (raw instanceof Response) return raw;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const { into, from } = mergeTestimonials(project.id, parsed.data.from, parsed.data.into, { by: getRequestSession(req)?.email });
    const strip = <T extends { withdrawTokenHash: string | null }>({ withdrawTokenHash: _h, ...t }: T) => t;
    return Response.json({ into: strip(into), from: strip(from) });
  } catch (err) {
    if (err instanceof MergeError) return jsonError(err.status, err.message);
    throw err;
  }
}
