import { jsonError, requireRole } from "@/lib/http";
import { ChannelError, channelPatchBody, channelToAdmin, deleteChannel, updateChannel } from "@/lib/notifications/channels";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = channelPatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (parsed.data.projectId && !getProjectById(parsed.data.projectId)) return jsonError(400, "Unknown project");
  try {
    const channel = updateChannel((await ctx.params).id, parsed.data);
    if (!channel) return jsonError(404, "Channel not found");
    return Response.json({ channel: channelToAdmin(channel) });
  } catch (err) {
    if (err instanceof ChannelError) return jsonError(err.status, err.message);
    throw err;
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  if (!deleteChannel((await ctx.params).id)) return jsonError(404, "Channel not found");
  return Response.json({ ok: true });
}
