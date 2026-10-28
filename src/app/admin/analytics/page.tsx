import { notFound } from "next/navigation";
import { analyticsUi, removedAlerts } from "@/lib/analytics";
import { requireFeature } from "@/lib/features";
import { onlyOpen } from "@/lib/access";
import { pageAccess } from "@/lib/server-session";
import { listProjects } from "@/lib/testimonials";
import { AppBar } from "../AppBar";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

/** AN-01: every project's numbers (or one project's) for a period, compared with the one before. */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { access } = await pageAccess();
  requireFeature("analytics");
  if (!analyticsUi()) notFound();
  const projects = onlyOpen(access, listProjects()).map((p) => ({ id: p.id, name: p.name }));
  const asked = (await searchParams).project;
  const project = asked && projects.some((p) => p.id === asked) ? asked : "all";
  return (
    <>
      <AppBar trail={[{ label: "Analytics" }]} />
      <main className="container stack-lg">
        <div className="page-head">
          <div>
            <h1>Analytics</h1>
            <p className="muted">How your widgets, forms and walls are doing. Cookieless: nobody is tracked from site to site or day to day.</p>
          </div>
        </div>
        <AnalyticsDashboard projects={projects} initialProject={project} alerts={removedAlerts(access.all ? undefined : [...access.ids])} />
      </main>
    </>
  );
}
