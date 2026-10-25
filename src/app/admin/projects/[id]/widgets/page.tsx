import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Widgets" };

/** Placeholder behind the `widgets` flag until WP4.3 builds this section. */
export default async function WidgetsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("widgets");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Widgets" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="widgets" />
        <div className="page-head">
          <div>
            <h1>Widgets</h1>
            <p className="muted">Saved widgets for your site, with a live preview of each layout.</p>
          </div>
        </div>
        <div className="empty" data-testid="section-placeholder">
          <Icon name="code" />
          <p>Widgets are on the way. Your current embed code keeps working.</p>
        </div>
      </main>
    </>
  );
}
