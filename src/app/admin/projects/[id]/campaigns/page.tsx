import { notFound } from "next/navigation";
import { campaignToAdmin, funnelsFor, listCampaigns } from "@/lib/campaigns";
import { emailMode } from "@/lib/email";
import { requireFeature } from "@/lib/features";
import { listForms } from "@/lib/forms";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { CampaignsList } from "./CampaignsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns" };

/** REQ-01: the project's email campaigns with their stats. */
export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("campaigns");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  const list = listCampaigns(project.id);
  const funnels = funnelsFor(project.id, list);
  return (
    <>
      <AppBar trail={[{ href: "/admin", label: "Projects" }, { href: `/admin/projects/${project.id}`, label: project.name }, { label: "Campaigns" }]} />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="campaigns" />
        <div className="page-head">
          <div>
            <h1>Campaigns</h1>
            <p className="muted">Email a batch of people your own wording, follow up with reminders, and see who opened, clicked and responded.</p>
          </div>
        </div>
        <CampaignsList
          projectId={project.id}
          emailOn={emailMode() !== "off"}
          forms={listForms(project.id).map((f) => ({ id: f.id, name: f.name, isDefault: f.isDefault }))}
          initial={JSON.parse(JSON.stringify(list.map((c) => campaignToAdmin(c, funnels.get(c.id)))))}
        />
      </main>
    </>
  );
}
