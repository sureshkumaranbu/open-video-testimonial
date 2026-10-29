import { notFound } from "next/navigation";
import { RemovedAlerts } from "@/components/analytics/RemovedAlerts";
import { analyticsUi, removedAlerts, widgetSummaries } from "@/lib/analytics";
import { featureOn, requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { listWidgets, widgetToAdmin } from "@/lib/widgets";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { WidgetsList } from "./WidgetsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Widgets" };

/** DISP-12: the project's saved widgets, and new ones by layout and the page they're for. */
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
            <p className="muted">Saved widgets for your site, each with its own layout, look and testimonials.</p>
          </div>
        </div>
        {analyticsUi() && <RemovedAlerts alerts={removedAlerts([project.id])} />}
        <WidgetsList
          projectId={project.id}
          initial={JSON.parse(JSON.stringify(listWidgets(project.id).map(widgetToAdmin)))}
          stats={analyticsUi() ? widgetSummaries(project.id) : undefined}
          commerce={featureOn("commerce")}
        />
      </main>
    </>
  );
}
