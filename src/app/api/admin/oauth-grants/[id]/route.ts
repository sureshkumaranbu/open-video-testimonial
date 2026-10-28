import { requestActor } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/http";
import { revokeGrant } from "@/lib/oauth";

/** Disconnects an assistant: its tokens stop working at once. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  if (!revokeGrant((await ctx.params).id, requestActor(req))) return jsonError(404, "Not found");
  return Response.json({ ok: true });
}
