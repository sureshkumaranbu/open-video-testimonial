import { notFound } from "next/navigation";
import { roleAtLeast } from "@/lib/access";
import { aiForProject } from "@/lib/ai";
import { caseStudyCandidates, caseStudyToAdmin, listCaseStudies } from "@/lib/case-studies";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { CaseStudies } from "./CaseStudies";

export const dynamic = "force-dynamic";
export const metadata = { title: "Case studies" };

/** SHARE-04: the project's case studies, behind the insights flag. `?from=<testimonial>` preselects one for a new case study. */
export default async function CaseStudiesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAdminPage();
  requireFeature("insights");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  const from = (await searchParams).from;
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Case studies" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="case-studies" />
        <div className="page-head">
          <div>
            <h1>Case studies</h1>
            <p className="muted">
              Turn a testimonial into a customer story with the challenge, the solution and the result, a pull quote and the numbers. Publish it as a page
              and a PDF.
            </p>
          </div>
        </div>
        <CaseStudies
          projectId={project.id}
          initial={JSON.parse(JSON.stringify(listCaseStudies(project.id).map(caseStudyToAdmin)))}
          candidates={caseStudyCandidates(project.id)}
          from={typeof from === "string" ? from : undefined}
          ai={aiForProject(project)}
          canEdit={roleAtLeast(session.role, "editor")}
        />
      </main>
    </>
  );
}
