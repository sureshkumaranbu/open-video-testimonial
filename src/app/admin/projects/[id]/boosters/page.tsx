import { notFound } from "next/navigation";
import { boosterToAdmin, listBoosters } from "@/lib/boosters";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { BoostersList } from "./BoostersList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review booster" };

/** BOOST-01: the project's review booster pages, each a draft until it's public. */
export default async function BoostersPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("booster");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Review booster" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="boosters" />
        <div className="page-head">
          <div>
            <h1>Review booster</h1>
            <p className="muted">A page of “Leave us a review” buttons for Google, Trustpilot and the other sites you use, with a QR code to print.</p>
          </div>
        </div>
        <BoostersList projectId={project.id} initial={JSON.parse(JSON.stringify(listBoosters(project.id).map((b) => boosterToAdmin(b, project))))} />
      </main>
    </>
  );
}
