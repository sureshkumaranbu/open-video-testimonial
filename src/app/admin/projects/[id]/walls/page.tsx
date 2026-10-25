import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Walls" };

/** Placeholder behind the `walls` flag until WP5.2 builds this section. */
export default async function WallsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("walls");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Walls" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="walls" />
        <div className="page-head">
          <div>
            <h1>Walls</h1>
            <p className="muted">Wall of love pages with your own hero, tabs and call to action.</p>
          </div>
        </div>
        <div className="empty" data-testid="section-placeholder">
          <Icon name="star" />
          <p>Walls are on the way. Your current wall page stays as it is.</p>
        </div>
      </main>
    </>
  );
}
