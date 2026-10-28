import { jsonError, requireRole } from "@/lib/http";
import { channelToAdmin, getChannel, noteResult, sendToChannel } from "@/lib/notifications/channels";
import { testMessage } from "@/lib/notifications/format";
import { getProjectById } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string }> };

/** The Test button: sends a sample message now and says how it went. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const channel = getChannel((await ctx.params).id);
  if (!channel) return jsonError(404, "Channel not found");
  const project = channel.projectId ? getProjectById(channel.projectId) : null;
  let error: string | null = null;
  try {
    await sendToChannel(channel, testMessage(project?.name ?? null));
  } catch (err) {
    error = (err as Error).message || "Couldn't send";
  }
  noteResult(channel.id, error);
  return Response.json({ ok: !error, error, channel: channelToAdmin(getChannel(channel.id)!) }, { status: error ? 502 : 200 });
}
