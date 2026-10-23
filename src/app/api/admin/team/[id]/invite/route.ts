import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireOwner } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { sendInvite } from "@/lib/team-invites";

/** Sends a fresh invitation link. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireOwner(req);
  if (denied) return denied;
  const member = getDb().select().from(schema.members).where(eq(schema.members.id, (await ctx.params).id)).get();
  if (!member?.invitedBy) return jsonError(404, "Not found");
  if (!rateLimit("team-invite", 20, 60 * 60 * 1000)) return jsonError(429, "Too many invitations. Please try again later.");
  try {
    return Response.json(await sendInvite(member.email, getRequestSession(req)!.email));
  } catch (err) {
    return jsonError(502, `The invitation couldn't be emailed: ${(err as Error).message}`);
  }
}
