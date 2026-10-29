import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { listReels, reelCandidates, reelToAdmin } from "@/lib/video/reels";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { Reels } from "./Reels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Highlight reels" };

/** VID-08: the project's highlight reels, behind the video2 flag. */
export default async function ReelsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("video2");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Highlight reels" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="reels" />
        <div className="page-head">
          <div>
            <h1>Highlight reels</h1>
            <p className="muted">
              Put the best moments of your approved video testimonials into one video: choose each part by selecting its words, add a title and a
              closing card, and turn our own background music on or off.
            </p>
          </div>
        </div>
        <Reels
          projectId={project.id}
          initial={JSON.parse(JSON.stringify(listReels(project.id).map(reelToAdmin)))}
          candidates={JSON.parse(JSON.stringify(reelCandidates(project.id)))}
        />
      </main>
    </>
  );
}
