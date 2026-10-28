import crypto from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Member, MemberRole } from "@/db/schema";
import { memberProjectIds, setMemberProjects } from "./access";
import { env } from "./env";
import { featureOn } from "./features";

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

/**
 * The role a non-owner has (TEAM-01): the one the owner set on their row
 * (editor or viewer), else admin. Only with the `team2` flag; without it
 * everyone but the owner is an admin, as before roles existed.
 */
function memberRole(row: Member | undefined): MemberRole {
  return featureOn("team2") && (row?.role === "editor" || row?.role === "viewer") ? row.role : "admin";
}

/** The role this address signs in with, or null if it may not sign in. */
export function roleFor(email: string): MemberRole | null {
  const e = normalizeEmail(email);
  const access = envAccess(e);
  if (access === "owner") return "owner";
  const row = getMember(e);
  if (access) return memberRole(row);
  // Only an invitation grants access through the table. Rows for people let
  // in by the environment just remember their name and last sign-in, so
  // taking them out of ADMIN_EMAILS really does lock them out.
  return row?.invitedBy ? memberRole(row) : null;
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

/** The roles the owner can give (TEAM-01). */
export const ASSIGNABLE_ROLES = ["admin", "editor", "viewer"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * Adds an invited member (an admin unless a role is given). They sign in
 * (and activate) with a link, Google, Apple or single sign-on. `projectIds`
 * limits an editor or viewer to those projects; null means every project.
 */
export function inviteMember(email: string, invitedBy: string, o: { role?: AssignableRole; projectIds?: string[] | null } = {}) {
  const e = normalizeEmail(email);
  if (roleFor(e)) throw new TeamError(`${e} can already sign in`);
  const role = o.role ?? "admin";
  // A leftover row (from before they left ADMIN_EMAILS) becomes the invitation.
  const row = getDb()
    .insert(schema.members)
    .values({ id: crypto.randomUUID(), email: e, role, invitedBy: normalizeEmail(invitedBy) })
    .onConflictDoUpdate({ target: schema.members.email, set: { invitedBy: normalizeEmail(invitedBy), activatedAt: null, role } })
    .returning()
    .get();
  setMemberProjects(row.id, role === "admin" ? null : (o.projectIds ?? null));
  return row;
}

/**
 * The owner changes someone's role and projects (TEAM-01). Works for invited
 * people and for those let in by ADMIN_EMAILS or an allowed domain (a row
 * remembers it); never for the owner. Admins always have every project.
 */
export function setMemberAccess(email: string, role: AssignableRole, projectIds: string[] | null) {
  const e = normalizeEmail(email);
  const access = envAccess(e);
  if (access === "owner") throw new TeamError("The owner's role can't be changed");
  const existing = getMember(e);
  if (!access && !existing?.invitedBy) throw new TeamError("Not found");
  const row = existing
    ? getDb().update(schema.members).set({ role }).where(eq(schema.members.id, existing.id)).returning().get()
    : getDb().insert(schema.members).values({ id: crypto.randomUUID(), email: e, role }).returning().get();
  setMemberProjects(row.id, role === "admin" ? null : projectIds);
  return row;
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
  /** TEAM-01: null for every project. */
  projectIds: string[] | null;
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
    role: access === "owner" ? "owner" : memberRole(row),
    projectIds: access === "owner" || memberRole(row) === "admin" || !row || row.allProjects ? null : memberProjectIds(row.id),
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
