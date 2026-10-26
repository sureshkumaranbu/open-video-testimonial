import { notFound } from "next/navigation";
import { IMPORT_FIELDS } from "@/lib/csv-import";
import { featureOn } from "@/lib/features";
import { listImporters } from "@/lib/importers/registry";
import { requireAdminPage } from "@/lib/server-session";
import { countByStatus, getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { DataTools } from "./DataTools";
import { ImportSources } from "./ImportSources";

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
        {featureOn("importers") && <ImportSources projectId={project.id} importers={listImporters()} />}
        <DataTools
          projectId={project.id}
          total={Object.values(counts).reduce((sum, n) => sum + n, 0)}
          fields={[...IMPORT_FIELDS]}
        />
      </main>
    </>
  );
}
