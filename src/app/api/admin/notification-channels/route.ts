import { jsonError, requireRole } from "@/lib/http";
import { ChannelError, channelToAdmin, createChannel, createChannelBody, listChannels } from "@/lib/notifications/channels";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

/** Chat channels (INT-02). `?projectId=` lists the ones that apply to that project (its own and every-project ones). */
export function GET(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  return Response.json({ channels: listChannels({ projectId }).map(channelToAdmin) });
}

export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = createChannelBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (parsed.data.projectId && !getProjectById(parsed.data.projectId)) return jsonError(400, "Unknown project");
  try {
    return Response.json({ channel: channelToAdmin(createChannel(parsed.data)) }, { status: 201 });
  } catch (err) {
    if (err instanceof ChannelError) return jsonError(err.status, err.message);
    throw err;
  }
}
