import { jsonError, requireAdmin } from "@/lib/http";
import { getJob } from "@/lib/jobs";

/** Progress of a background job (used by the import screen). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const job = getJob((await ctx.params).id);
  if (!job) return jsonError(404, "Job not found");
  return Response.json({ id: job.id, type: job.type, status: job.status, attempts: job.attempts, error: job.lastError });
}
