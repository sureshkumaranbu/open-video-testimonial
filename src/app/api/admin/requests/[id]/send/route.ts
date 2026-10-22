import { emailEnabled } from "@/lib/email";
import { jsonError, requireAdmin } from "@/lib/http";
import { getRequest, queueInvite, withLink } from "@/lib/requests";
import { getProjectById } from "@/lib/testimonials";

/** Sends (or re-sends) the invitation email. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const r = getRequest((await ctx.params).id);
  if (!r) return jsonError(404, "Request not found");
  if (!emailEnabled()) return jsonError(409, "Email isn't set up on this server (SMTP_URL)");
  if (r.status !== "waiting") {
    return jsonError(409, r.status === "unsubscribed" ? "This person unsubscribed" : "This person already responded");
  }
  const project = getProjectById(r.projectId)!;
  return Response.json({ request: withLink(project, queueInvite(project, r)) });
}
