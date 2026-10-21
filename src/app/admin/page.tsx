import Link from "next/link";
import { requireAdminPage } from "@/lib/server-session";
import { countByStatus, listProjects } from "@/lib/testimonials";
import { LogoutButton, NewProjectForm } from "./AdminForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function AdminHome() {
  await requireAdminPage();
  const projects = listProjects().map((p) => ({ ...p, counts: countByStatus(p.id) }));

  return (
    <main className="container stack">
      <div className="topbar">
        <Link href="/admin" className="brand">
          Plaudit
        </Link>
        <LogoutButton />
      </div>
      <h1 style={{ margin: 0 }}>Projects</h1>
      {projects.length === 0 && (
        <p className="muted">Create your first project to get a collection link.</p>
      )}
      <div className="stack">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/admin/projects/${p.id}`}
            className="card row"
            style={{ justifyContent: "space-between", textDecoration: "none", color: "inherit" }}
          >
            <div>
              <strong>{p.name}</strong>
              <div className="muted small">/{p.slug}</div>
            </div>
            <div className="row small">
              <span className="badge pending">{p.counts.pending} pending</span>
              <span className="badge approved">{p.counts.approved} approved</span>
            </div>
          </Link>
        ))}
      </div>
      <NewProjectForm />
    </main>
  );
}
