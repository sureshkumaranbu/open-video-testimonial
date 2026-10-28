import { emailEnabled } from "@/lib/email";
import { jsonError, requireRole } from "@/lib/http";
import { getRequest, queueInvite, withLink } from "@/lib/requests";
import { getProjectById } from "@/lib/testimonials";

/** Sends (or re-sends) the invitation email. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const r = getRequest((await ctx.params).id);
  if (!r) return jsonError(404, "Request not found");
  if (!emailEnabled()) return jsonError(409, "Email isn't set up on this server (SMTP_URL)");
  if (r.status !== "waiting") {
    const why = { unsubscribed: "This person unsubscribed", declined: "This person said no thanks", responded: "This person already responded" };
    return jsonError(409, why[r.status]);
  }
  const project = getProjectById(r.projectId)!;
  return Response.json({ request: withLink(project, queueInvite(project, r)) });
}
