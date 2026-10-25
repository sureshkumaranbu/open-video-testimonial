import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project settings" };

/** Placeholder behind the `forms` flag until WP1.5 builds this section. */
export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("forms");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Project settings" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="settings" />
        <div className="page-head">
          <div>
            <h1>Project settings</h1>
            <p className="muted">The project's name, link, brand kit and tags.</p>
          </div>
        </div>
        <div className="empty" data-testid="section-placeholder">
          <Icon name="sliders" />
          <p>Project settings are on the way.</p>
        </div>
      </main>
    </>
  );
}
