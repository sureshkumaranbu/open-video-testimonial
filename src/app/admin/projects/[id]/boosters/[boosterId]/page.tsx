import { notFound } from "next/navigation";
import { boosterToAdmin, getBooster } from "@/lib/boosters";
import { requireFeature } from "@/lib/features";
import { formUrl, listForms } from "@/lib/forms";
import { env } from "@/lib/env";
import { placesSearchAvailable } from "@/lib/google-places";
import { mediaUrl } from "@/lib/storage";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../../AppBar";
import { ProjectTabs } from "../../ProjectTabs";
import { BoosterEditor } from "./BoosterEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Booster editor" };

/** BOOST-01..05: the booster editor, settings on the left and the live preview on the right. */
export default async function BoosterEditorPage({ params }: { params: Promise<{ id: string; boosterId: string }> }) {
  await requireAdminPage();
  requireFeature("booster");
  const { id, boosterId } = await params;
  const project = getProjectById(id);
  const booster = getBooster(boosterId);
  if (!project || !booster || booster.projectId !== project.id) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { href: `/admin/projects/${project.id}/boosters`, label: "Review booster" },
          { label: booster.name },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="boosters" />
        <BoosterEditor
          project={{ id: project.id, slug: project.slug, name: project.name, logoUrl: mediaUrl(project.logoKey) }}
          initial={JSON.parse(JSON.stringify(boosterToAdmin(booster, project)))}
          forms={listForms(project.id).map((f) => ({ id: f.id, name: f.name, url: `${env.publicUrl}${formUrl(project, f)}` }))}
          placesSearch={placesSearchAvailable()}
        />
      </main>
    </>
  );
}
