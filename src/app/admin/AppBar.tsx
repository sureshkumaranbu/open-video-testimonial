import Link from "next/link";
import { LogoutButton } from "./AdminForms";

/** Sticky top bar for the owner area, with an optional breadcrumb trail. */
export function AppBar({ trail }: { trail?: { href?: string; label: string }[] }) {
  return (
    <header className="app-bar">
      <div className="container">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/admin" className="brand">
            <span className="brand-dot" aria-hidden />
            Plaudit
          </Link>
          {trail?.map((c) => (
            <span key={c.label} className="row" style={{ gap: "var(--space-2)", flexWrap: "nowrap", minWidth: 0 }}>
              <span aria-hidden>/</span>
              {c.href ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span style={{ color: "var(--ink)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
        <div className="row" style={{ gap: "var(--space-2)", flexWrap: "nowrap" }}>
          <Link href="/admin/settings" className="button ghost small">
            Settings
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
