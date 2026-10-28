import { historyToJson, listHistory } from "@/lib/history";
import { jsonError, requireRole } from "@/lib/http";
import { getTestimonial } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string }> };

/** The testimonial's edit history, oldest first: who changed what, and when. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getTestimonial(id)) return jsonError(404, "Testimonial not found");
  return Response.json({ history: listHistory(id).map(historyToJson) });
}
