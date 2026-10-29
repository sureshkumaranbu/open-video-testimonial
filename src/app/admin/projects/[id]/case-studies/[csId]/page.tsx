import { notFound } from "next/navigation";
import { roleAtLeast } from "@/lib/access";
import { aiForProject } from "@/lib/ai";
import { caseStudyToAdmin, getCaseStudy } from "@/lib/case-studies";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { mediaUrl } from "@/lib/storage";
import { getProjectById, getTestimonial } from "@/lib/testimonials";
import { accentStyle } from "@/lib/theme";
import { AppBar } from "../../../../AppBar";
import { ProjectTabs } from "../../ProjectTabs";
import { CaseStudyEditor } from "./CaseStudyEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Case study" };

/** SHARE-04: one case study's editor with its live preview. */
export default async function CaseStudyPage({ params }: { params: Promise<{ id: string; csId: string }> }) {
  const session = await requireAdminPage();
  requireFeature("insights");
  const { id, csId } = await params;
  const project = getProjectById(id);
  const cs = getCaseStudy(csId);
  if (!project || !cs || cs.projectId !== project.id) notFound();
  const t = getTestimonial(cs.testimonialId);
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { href: `/admin/projects/${project.id}/case-studies`, label: "Case studies" },
          { label: cs.title },
        ]}
      />
      <main className="container stack-lg" style={accentStyle(project.accentColor)}>
        <ProjectTabs projectId={project.id} active="case-studies" />
        <CaseStudyEditor
          projectId={project.id}
          projectName={project.name}
          initial={JSON.parse(JSON.stringify(caseStudyToAdmin(cs)))}
          avatarUrl={mediaUrl(t?.avatarKey)}
          testimonialId={cs.testimonialId}
          ai={aiForProject(project)}
          canEdit={roleAtLeast(session.role, "editor")}
        />
      </main>
    </>
  );
}
