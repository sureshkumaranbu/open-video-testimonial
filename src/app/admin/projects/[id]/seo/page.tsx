import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO" };

/** Placeholder behind the `walls` flag until WP5.1 builds this section. */
export default async function SeoPage({ params }: { params: Promise<{ id: string }> }) {
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
          { label: "SEO" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="seo" />
        <div className="page-head">
          <div>
            <h1>SEO</h1>
            <p className="muted">Review snippets that help search engines show your ratings.</p>
          </div>
        </div>
        <div className="empty" data-testid="section-placeholder">
          <Icon name="globe" />
          <p>SEO snippets are on the way.</p>
        </div>
      </main>
    </>
  );
}
