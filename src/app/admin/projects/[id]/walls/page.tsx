import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { listWalls, wallToAdmin } from "@/lib/walls";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { WallsList } from "./WallsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Walls" };

/** WALL-01: the project's walls of love, each a draft until published. */
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
        <WallsList
          projectId={project.id}
          projectSlug={project.slug}
          initial={JSON.parse(JSON.stringify(listWalls(project.id).map((w) => wallToAdmin(w, project))))}
        />
      </main>
    </>
  );
}
