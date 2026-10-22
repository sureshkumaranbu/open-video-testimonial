import { notFound } from "next/navigation";
import { IMPORT_FIELDS } from "@/lib/csv-import";
import { requireAdminPage } from "@/lib/server-session";
import { countByStatus, getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { DataTools } from "./DataTools";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import & export" };

export default async function DataPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const project = getProjectById((await params).id);
  if (!project) notFound();
  const counts = countByStatus(project.id);
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Import & export" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="data" />
        <div className="page-head">
          <div>
            <h1>Import &amp; export</h1>
            <p className="muted">Your data is yours: take all of it with you, or bring testimonials in from elsewhere.</p>
          </div>
        </div>
        <DataTools
          projectId={project.id}
          total={counts.pending + counts.approved + counts.rejected}
          fields={[...IMPORT_FIELDS]}
        />
      </main>
    </>
  );
}
