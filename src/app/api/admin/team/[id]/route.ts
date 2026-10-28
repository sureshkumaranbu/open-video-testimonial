import { auditRequest } from "@/lib/audit";
import { jsonError, requireOwner } from "@/lib/http";
import { removeMember, TeamError } from "@/lib/members";

/** Removes an invited admin. Their sessions stop working at once. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireOwner(req);
  if (denied) return denied;
  try {
    const removed = removeMember((await ctx.params).id).email;
    auditRequest(req, "member.remove", { objectType: "member", objectId: removed, summary: removed });
    return Response.json({ removed });
  } catch (err) {
    if (err instanceof TeamError) return jsonError(err.message === "Not found" ? 404 : 400, err.message);
    throw err;
  }
}
