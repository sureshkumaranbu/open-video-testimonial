import Link from "next/link";
import { Icon } from "@/components/Icon";
import { LogoutButton } from "./AdminForms";

/**
 * Sticky top bar for the owner area, with an optional breadcrumb trail. On
 * phones the trail shrinks to the current page and the actions to icons.
 */
export function AppBar({ trail }: { trail?: { href?: string; label: string }[] }) {
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
