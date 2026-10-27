import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireFeature } from "@/lib/features";
import { listRedirects, listTagUsage, parseBrand } from "@/lib/projects";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { ProjectSettings } from "./ProjectSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project settings" };

/** TEAM-04: the project's name and link (old links keep working), brand kit, tags and deletion. */
export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPage();
  // Project settings goes live with forms (see ProjectTabs).
  requireFeature("forms");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Project settings" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="settings" />
        <div className="page-head">
          <div>
            <h1>Project settings</h1>
            <p className="muted">The project&apos;s name, link, brand kit and tags.</p>
          </div>
        </div>
        <ProjectSettings
          project={{
            id: project.id,
            name: project.name,
            slug: project.slug,
            website: project.website,
            businessType: project.businessType,
            logoKey: project.logoKey,
            accentColor: project.accentColor,
          }}
          brand={parseBrand(project.brand)}
          tags={listTagUsage(project.id)}
          redirects={listRedirects(project.id).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
          isOwner={session.role === "owner"}
          publicUrl={env.publicUrl}
        />
      </main>
    </>
  );
}
