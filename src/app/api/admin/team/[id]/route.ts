import { jsonError, requireOwner } from "@/lib/http";
import { removeMember, TeamError } from "@/lib/members";

/** Removes an invited admin. Their sessions stop working at once. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireOwner(req);
  if (denied) return denied;
  try {
    return Response.json({ removed: removeMember((await ctx.params).id).email });
  } catch (err) {
    if (err instanceof TeamError) return jsonError(err.message === "Not found" ? 404 : 400, err.message);
    throw err;
  }
}
