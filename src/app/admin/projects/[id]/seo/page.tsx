import { notFound } from "next/navigation";
import { analyticsUi, parseRange, snippetRenders } from "@/lib/analytics";
import { env } from "@/lib/env";
import { requireFeature } from "@/lib/features";
import { listForms } from "@/lib/forms";
import { listTagUsage } from "@/lib/projects";
import { listSnippets, snippetToAdmin } from "@/lib/seo-snippets";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { SnippetsPanel } from "./SnippetsPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO" };

/** SEO-01, SEO-02: review snippets for the owner's own pages, with guidance and a result preview. */
export default async function SeoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("walls");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  const snippets = listSnippets(project.id).map((s) => snippetToAdmin(s, project, env.publicUrl));
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "SEO" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="seo" />
        <div className="page-head">
          <div>
            <h1>SEO</h1>
            <p className="muted">
              Review data search engines can read, for your own product or pricing pages. Your walls include it on their own.
            </p>
          </div>
        </div>
        <SnippetsPanel
          projectId={project.id}
          projectName={project.name}
          origin={env.publicUrl}
          tags={listTagUsage(project.id).map((t) => t.name)}
          forms={listForms(project.id).map((f) => ({ id: f.id, name: f.name }))}
          initial={JSON.parse(JSON.stringify(snippets))}
          renders={analyticsUi() ? snippetRenders(project.id, parseRange(null, null)) : undefined}
        />
      </main>
    </>
  );
}
