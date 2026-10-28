import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { canOpen, type Level, projectAccessFor, roleAtLeast } from "./access";
import { sessionCookieName, sessionFromToken } from "./auth";

/** For server components: returns the session or redirects to the login page. */
export async function requireAdminPage() {
  const store = await cookies();
  const session = sessionFromToken(store.get(sessionCookieName())?.value);
  if (!session) redirect("/admin/login");
  return session;
}

/** A page for a role of at least `level` (TEAM-01): others get the not-found page. */
export async function requireRolePage(level: Level) {
  const session = await requireAdminPage();
  if (!roleAtLeast(session.role, level)) notFound();
  return session;
}

/** A project's pages: someone without access to it gets the not-found page, as if it didn't exist. */
export async function requireProjectPage(projectId: string) {
  const session = await requireAdminPage();
  if (!canOpen(projectAccessFor(session.email, session.role), projectId)) notFound();
  return session;
}

/** The signed-in person and the projects they may open, for lists. */
export async function pageAccess() {
  const session = await requireAdminPage();
  return { session, access: projectAccessFor(session.email, session.role) };
}
