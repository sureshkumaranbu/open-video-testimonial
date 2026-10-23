import crypto from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Member, MemberRole } from "@/db/schema";
import { env } from "./env";

/**
 * Who may sign in to the dashboard. There is one owner (ADMIN_EMAIL); everyone
 * else is an admin, let in by ADMIN_EMAILS, ALLOWED_EMAIL_DOMAINS or an
 * invitation from Settings → Team.
 */

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Where an admin's access comes from, for the Team page. */
export type Access = "owner" | "admin-emails" | "domain" | "invited";

function envAccess(email: string): Access | null {
  if (!email) return null;
  if (env.adminEmail && email === normalizeEmail(env.adminEmail)) return "owner";
  if (env.adminEmails.includes(email)) return "admin-emails";
  const domain = email.split("@")[1];
  if (domain && env.allowedEmailDomains.includes(domain)) return "domain";
  return null;
}

export function getMember(email: string): Member | undefined {
  return getDb().select().from(schema.members).where(eq(schema.members.email, normalizeEmail(email))).get();
}

/** The role this address signs in with, or null if it may not sign in. */
export function roleFor(email: string): MemberRole | null {
  const e = normalizeEmail(email);
  const access = envAccess(e);
  if (access === "owner") return "owner";
  if (access) return "admin";
  // Only an invitation grants access through the table. Rows for people let
  // in by the environment just remember their name and last sign-in, so
  // taking them out of ADMIN_EMAILS really does lock them out.
  return getMember(e)?.invitedBy ? "admin" : null;
}

/** Notes a successful sign-in, activating an invitation and keeping a first-time name. */
export function recordSignIn(email: string, name?: string | null) {
  const e = normalizeEmail(email);
  const now = new Date();
  const existing = getMember(e);
  if (!existing) {
    getDb()
      .insert(schema.members)
      .values({ id: crypto.randomUUID(), email: e, name: name || null, role: roleFor(e) ?? "admin", activatedAt: now, lastSignInAt: now })
      .onConflictDoNothing()
      .run();
    return;
  }
  getDb()
    .update(schema.members)
    .set({ lastSignInAt: now, activatedAt: existing.activatedAt ?? now, name: existing.name || name || null })
    .where(eq(schema.members.id, existing.id))
    .run();
}

export class TeamError extends Error {}

/** Adds an invited admin. They sign in (and activate) with a link, Google or Apple. */
export function inviteMember(email: string, invitedBy: string) {
  const e = normalizeEmail(email);
  if (roleFor(e)) throw new TeamError(`${e} can already sign in`);
  // A leftover row (from before they left ADMIN_EMAILS) becomes the invitation.
  return getDb()
    .insert(schema.members)
    .values({ id: crypto.randomUUID(), email: e, role: "admin", invitedBy: normalizeEmail(invitedBy) })
    .onConflictDoUpdate({ target: schema.members.email, set: { invitedBy: normalizeEmail(invitedBy), activatedAt: null } })
    .returning()
    .get();
}

/** Removes an invited admin. People let in by the environment can't be removed here. */
export function removeMember(id: string) {
  const member = getDb().select().from(schema.members).where(eq(schema.members.id, id)).get();
  if (!member) throw new TeamError("Not found");
  if (envAccess(member.email)) {
    throw new TeamError(`${member.email} is allowed by the server's settings (ADMIN_EMAIL, ADMIN_EMAILS or ALLOWED_EMAIL_DOMAINS), so remove them there`);
  }
  getDb().delete(schema.members).where(eq(schema.members.id, id)).run();
  getDb().delete(schema.loginTokens).where(eq(schema.loginTokens.email, member.email)).run();
  return member;
}

export type TeamEntry = {
  id: string | null;
  email: string;
  name: string | null;
  role: MemberRole;
  access: Access;
  invitedBy: string | null;
  activatedAt: string | null;
  lastSignInAt: string | null;
};

/** Everyone who can sign in by address, for Settings → Team. Domain rules are listed separately. */
export function listTeam(): TeamEntry[] {
  const rows = getDb().select().from(schema.members).orderBy(asc(schema.members.createdAt)).all();
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const entry = (email: string, access: Access, row?: Member): TeamEntry => ({
    id: row?.id ?? null,
    email,
    name: row?.name ?? null,
    role: access === "owner" ? "owner" : "admin",
    access,
    invitedBy: row?.invitedBy ?? null,
    activatedAt: iso(row?.activatedAt),
    lastSignInAt: iso(row?.lastSignInAt),
  });
  const fromEnv = [env.adminEmail, ...env.adminEmails].map(normalizeEmail).filter(Boolean);
  const seen = new Set<string>();
  const team: TeamEntry[] = [];
  for (const email of fromEnv) {
    if (seen.has(email)) continue;
    seen.add(email);
    team.push(entry(email, envAccess(email)!, byEmail.get(email)));
  }
  for (const row of rows) {
    if (seen.has(row.email) || (!row.invitedBy && !envAccess(row.email))) continue;
    seen.add(row.email);
    team.push(entry(row.email, envAccess(row.email) ?? "invited", row));
  }
  return team;
}
