import { cookies } from "next/headers";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { analyticsUi } from "@/lib/analytics";
import { sessionCookieName, sessionFromToken } from "@/lib/auth";
import { LogoutButton } from "./AdminForms";

/**
 * Sticky top bar for the owner area, with an optional breadcrumb trail. On
 * phones the trail shrinks to the current page and the actions to icons.
 */
export async function AppBar({ trail }: { trail?: { href?: string; label: string }[] }) {
  // TEAM-01: editors and viewers see their role, so a refused change isn't a surprise.
  const session = sessionFromToken((await cookies()).get(sessionCookieName())?.value);
  const role = session && (session.role === "editor" || session.role === "viewer") ? session.role : null;
  return (
    <header className="app-bar">
      <div className="container">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/admin" className="brand">
            <span className="brand-dot" aria-hidden />
            Plaudit
          </Link>
          {trail?.map((c, i) => (
            <span key={c.label} className={i === trail.length - 1 ? "crumb current" : "crumb"}>
              <span aria-hidden>/</span>
              {c.href ? <Link href={c.href}>{c.label}</Link> : <span className="crumb-here">{c.label}</span>}
            </span>
          ))}
        </nav>
        <div className="app-bar-actions">
          {role && (
            <span
              className="badge"
              data-testid="role-badge"
              title={role === "viewer" ? "You can look and share approved testimonials, not change things" : "You can change content, not settings or the team"}
            >
              {role === "viewer" ? "Viewer" : "Editor"}
            </span>
          )}
          {analyticsUi() && (
            <Link href="/admin/analytics" className="button ghost small" aria-label="Analytics">
              <Icon name="chart" />
              <span className="hide-narrow">Analytics</span>
            </Link>
          )}
          <Link href="/admin/settings" className="button ghost small" aria-label="Settings">
            <Icon name="sliders" />
            <span className="hide-narrow">Settings</span>
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
