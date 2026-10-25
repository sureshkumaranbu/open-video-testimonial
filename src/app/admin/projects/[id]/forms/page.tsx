import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forms" };

/** Placeholder behind the `forms` flag until WP2.5 builds this section. */
export default async function FormsPage({ params }: { params: Promise<{ id: string }> }) {
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
          { label: "Forms" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="forms" />
        <div className="page-head">
          <div>
            <h1>Forms</h1>
            <p className="muted">Several forms for one project, each with its own questions, fields and look.</p>
          </div>
        </div>
        <div className="empty" data-testid="section-placeholder">
          <Icon name="layout" />
          <p>Forms are on the way. Your collection page works as it does today.</p>
        </div>
      </main>
    </>
  );
}
