import { jsonError, requireAdmin } from "@/lib/http";
import { getRunProgress } from "@/lib/runs";

/** Progress of a background task run (import, storage copy, discovery), polled by the dashboard. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const run = getRunProgress((await ctx.params).id);
  if (!run) return jsonError(404, "Run not found");
  return Response.json({ run });
}
