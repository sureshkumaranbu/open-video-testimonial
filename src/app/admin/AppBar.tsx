import { cookies } from "next/headers";
import { onlyOpen, projectAccessFor } from "@/lib/access";
import { analyticsUi } from "@/lib/analytics";
import { sessionCookieName, sessionFromToken } from "@/lib/auth";
import { listProjects } from "@/lib/testimonials";
import { accentStyle } from "@/lib/theme";
import { Shell } from "./_shell/Shell";
import type { Crumb } from "./_shell/nav";
import { projectSections } from "./projects/[id]/ProjectTabs";

/**
 * The dashboard's app shell around every signed-in page: the sidebar (the
 * project switcher, the project's sections, Analytics, Settings, light/dark
 * and Sign out) and the top bar with the breadcrumb trail. Pages pass only
 * their trail, as before; everything else is worked out here. Feature flags
 * and roles decide what's listed exactly as the old top bar and the
 * project's tabs did.
 */
export async function AppBar({ trail }: { trail?: Crumb[] }) {
  // TEAM-01: editors and viewers see their role, so a refused change isn't a surprise.
  const session = sessionFromToken((await cookies()).get(sessionCookieName())?.value);
  const role = session && (session.role === "editor" || session.role === "viewer") ? session.role : null;
  // The switcher lists the projects this person may open (TEAM-05), newest first.
  const projects = session
    ? onlyOpen(projectAccessFor(session.email, session.role), listProjects()).map((p) => {
        const accent = accentStyle(p.accentColor);
        return { id: p.id, name: p.name, slug: p.slug, accent: accent["--accent"], onAccent: accent["--on-accent"] };
      })
    : [];
  return (
    <Shell
      trail={trail?.length ? trail : [{ label: "Projects" }]}
      role={role}
      analytics={analyticsUi()}
      projects={projects}
      sections={projectSections()}
    />
  );
}
