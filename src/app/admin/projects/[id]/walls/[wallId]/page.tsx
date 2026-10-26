import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireFeature } from "@/lib/features";
import { listForms } from "@/lib/forms";
import { listTagUsage } from "@/lib/projects";
import { listFeed } from "@/lib/public-feed";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { getWall, wallToAdmin } from "@/lib/walls";
import { AppBar } from "../../../../AppBar";
import { ProjectTabs } from "../../ProjectTabs";
import { WallEditor } from "./WallEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wall editor" };

/** WALL-01..03: the wall editor, settings on the left and the live preview on the right. */
export default async function WallEditorPage({ params }: { params: Promise<{ id: string; wallId: string }> }) {
  await requireAdminPage();
  requireFeature("walls");
  const { id, wallId } = await params;
  const project = getProjectById(id);
  const wall = getWall(wallId);
  if (!project || !wall || wall.projectId !== project.id) notFound();
  // Featured testimonial choices: the newest public ones.
  const featured = listFeed(project.id, { max: 100 }, { limit: 100 }).map((t) => ({ id: t.id, label: `${t.name}: ${(t.extra.headline || t.text || "Video").slice(0, 60)}` }));
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { href: `/admin/projects/${project.id}/walls`, label: "Walls" },
          { label: wall.name },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="walls" />
        <WallEditor
          project={{ id: project.id, slug: project.slug, name: project.name }}
          initial={JSON.parse(JSON.stringify(wallToAdmin(wall, project)))}
          origin={env.publicUrl}
          tags={listTagUsage(project.id).map((t) => t.name)}
          forms={listForms(project.id).map((f) => ({ id: f.id, name: f.name }))}
          featured={featured}
        />
      </main>
    </>
  );
}
