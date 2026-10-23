import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { jsonError, requireAdmin, requireOwner } from "@/lib/http";
import { inviteMember, listTeam, TeamError } from "@/lib/members";
import { rateLimit } from "@/lib/rate-limit";
import { sendInvite } from "@/lib/team-invites";

export function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return Response.json({ team: listTeam(), domains: env.allowedEmailDomains, you: getRequestSession(req) });
}

const schema = z.object({ email: z.email("Enter a valid email address").max(254) });

/** The owner invites someone; they get a link that activates them. */
export async function POST(req: Request) {
  const denied = requireOwner(req);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Enter a valid email address");
  if (!rateLimit("team-invite", 20, 60 * 60 * 1000)) return jsonError(429, "Too many invitations. Please try again later.");
  const owner = getRequestSession(req)!.email;
  let member;
  try {
    member = inviteMember(parsed.data.email, owner);
  } catch (err) {
    if (err instanceof TeamError) return jsonError(409, err.message);
    throw err;
  }
  try {
    return Response.json({ member, ...(await sendInvite(member.email, owner)) }, { status: 201 });
  } catch (err) {
    return Response.json({ member, sent: false, error: `The invitation couldn't be emailed: ${(err as Error).message}` }, { status: 201 });
  }
}
