import { notFound } from "next/navigation";
import { roleAtLeast } from "@/lib/access";
import { aiEnabled } from "@/lib/ai";
import { requireFeature } from "@/lib/features";
import { npsForms } from "@/lib/insights/nps";
import { listTagUsage } from "@/lib/projects";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { Insights } from "./Insights";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

/** VOC-01 and NPS-01: Voice of Customer, ask a question, NPS and saved reports, behind the insights flag. */
export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPage();
  requireFeature("insights");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Insights" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="insights" />
        <div className="page-head">
          <div>
            <h1>Insights</h1>
            <p className="muted">What your customers say, across every testimonial and survey answer: themes, what they love, what to improve, and your NPS.</p>
          </div>
        </div>
        <Insights
          projectId={project.id}
          tags={listTagUsage(project.id).map((t) => t.name)}
          forms={npsForms(project.id)}
          ai={{ server: aiEnabled(), project: project.aiEnabled }}
          role={{ editor: roleAtLeast(session.role, "editor"), admin: roleAtLeast(session.role, "admin") }}
        />
      </main>
    </>
  );
}
