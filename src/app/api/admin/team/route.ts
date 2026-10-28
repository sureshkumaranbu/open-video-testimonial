import { auditRequest } from "@/lib/audit";
import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { jsonError, requireRole, requireOwner } from "@/lib/http";
import { teamOn } from "@/lib/access";
import { ASSIGNABLE_ROLES, inviteMember, listTeam, setMemberAccess, TeamError } from "@/lib/members";
import { rateLimit } from "@/lib/rate-limit";
import { sendInvite } from "@/lib/team-invites";

export function GET(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  return Response.json({ team: listTeam(), domains: env.allowedEmailDomains, you: getRequestSession(req) });
}

const schema = z.object({
  email: z.email("Enter a valid email address").max(254),
  /** TEAM-01 (flag team2): admin by default. */
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  /** Only these projects (editors and viewers); absent or null for every project. */
  projectIds: z.array(z.string().max(64)).max(200).nullish(),
});

const accessSchema = z.object({
  email: z.email().max(254),
  role: z.enum(ASSIGNABLE_ROLES),
  projectIds: z.array(z.string().max(64)).max(200).nullable(),
});

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
    member = inviteMember(parsed.data.email, owner, teamOn() ? { role: parsed.data.role, projectIds: parsed.data.projectIds ?? null } : {});
  } catch (err) {
    if (err instanceof TeamError) return jsonError(409, err.message);
    throw err;
  }
  auditRequest(req, "member.invite", { objectType: "member", objectId: member.email, summary: member.email, meta: { role: member.role, projectIds: parsed.data.projectIds ?? "all" } });
  try {
    return Response.json({ member, ...(await sendInvite(member.email, owner)) }, { status: 201 });
  } catch (err) {
    return Response.json({ member, sent: false, error: `The invitation couldn't be emailed: ${(err as Error).message}` }, { status: 201 });
  }
}

/** TEAM-01: the owner changes someone's role and projects: `{email, role, projectIds}` (null for every project). */
export async function PATCH(req: Request) {
  const denied = requireOwner(req);
  if (denied) return denied;
  if (!teamOn()) return jsonError(404, "Roles are switched off on this server (team2)");
  const parsed = accessSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Choose a role, and every project or a list of them");
  const { email, role, projectIds } = parsed.data;
  try {
    setMemberAccess(email, role, projectIds);
    auditRequest(req, "member.access", { objectType: "member", objectId: email.toLowerCase(), summary: email.toLowerCase(), meta: { role, projectIds: role === "admin" ? "all" : (projectIds ?? "all") } });
  } catch (err) {
    if (err instanceof TeamError) return jsonError(err.message === "Not found" ? 404 : 400, err.message);
    throw err;
  }
  return Response.json({ team: listTeam() });
}
