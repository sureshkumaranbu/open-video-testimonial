import Link from "next/link";
import { Icon } from "@/components/Icon";
import { requireAdminPage } from "@/lib/server-session";
import { countByStatus, listProjects } from "@/lib/testimonials";
import { accentStyle } from "@/lib/theme";
import { NewProjectForm } from "./AdminForms";
import { AppBar } from "./AppBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function AdminHome() {
  await requireAdminPage();
  const projects = listProjects().map((p) => ({ ...p, counts: countByStatus(p.id) }));
  const waiting = projects.reduce((n, p) => n + p.counts.pending, 0);

  return (
    <>
      <AppBar />
      <main className="container stack-lg">
        <div className="page-head">
          <div>
            <h1>Projects</h1>
            <p className="muted">
              {projects.length === 0
                ? "Create your first project to get a collection link."
                : waiting > 0
                  ? `${waiting} new ${waiting === 1 ? "testimonial is" : "testimonials are"} waiting for review.`
                  : "You're all caught up."}
            </p>
          </div>
        </div>
        <div className="project-grid">
          {projects.map((p) => (
            <Link key={p.id} href={`/admin/projects/${p.id}`} className="card project-card" style={accentStyle(p.accentColor)}>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <span className="org-mark" aria-hidden>
                  {p.name.trim().charAt(0).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block" }}>{p.name}</strong>
                  <span className="slug">/{p.slug}</span>
                </div>
                <Icon name="external" className="open" />
              </div>
              <div className="row small">
                <span className="badge pending">{p.counts.pending} pending</span>
                <span className="badge approved">{p.counts.approved} approved</span>
              </div>
            </Link>
          ))}
          <NewProjectForm />
        </div>
      </main>
    </>
  );
}
