import { canOpen, projectOfJob, roleAtLeast } from "@/lib/access";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requestAccess, requireRole } from "@/lib/http";
import { getJob } from "@/lib/jobs";

/**
 * Progress of a background job (used by the import screen). L19: a member
 * limited to some projects sees only jobs for those, and a job that names no
 * project only admins see. Anything else is the same 404 as an unknown id,
 * so ids can't be probed.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const job = getJob((await ctx.params).id);
  if (!job) return jsonError(404, "Job not found");
  const projectId = projectOfJob(job);
  const allowed = projectId ? canOpen(requestAccess(req), projectId) : roleAtLeast(getRequestSession(req)!.role, "admin");
  if (!allowed) return jsonError(404, "Job not found");
  return Response.json({ id: job.id, type: job.type, status: job.status, attempts: job.attempts, error: job.lastError });
}
