import { notFound } from "next/navigation";
import { campaignToAdmin, customersWithEmail, funnelOf, getCampaign, recipientToAdmin } from "@/lib/campaigns";
import { emailMode } from "@/lib/email";
import { env } from "@/lib/env";
import { requireFeature } from "@/lib/features";
import { listForms } from "@/lib/forms";
import { listRequests } from "@/lib/requests";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../../AppBar";
import { ProjectTabs } from "../../ProjectTabs";
import { CampaignView } from "./CampaignView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign" };

/** REQ-01..07: one campaign: its funnel, recipients, email (with preview and test send) and auto-collect. */
export default async function CampaignPage({ params }: { params: Promise<{ id: string; campaignId: string }> }) {
  const session = await requireAdminPage();
  requireFeature("campaigns");
  const { id, campaignId } = await params;
  const project = getProjectById(id);
  const campaign = getCampaign(campaignId);
  if (!project || !campaign || campaign.projectId !== project.id) notFound();
  const rows = listRequests(project.id, { campaignId: campaign.id });
  const mode = emailMode();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { href: `/admin/projects/${project.id}/campaigns`, label: "Campaigns" },
          { label: campaign.name },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="campaigns" />
        <CampaignView
          project={{ id: project.id, name: project.name }}
          email={{ mode, from: mode === "off" ? null : env.smtpFrom, me: session.email ?? null }}
          apiBase={`${env.publicUrl}/api/v1`}
          forms={listForms(project.id).map((f) => ({ id: f.id, name: f.name, isDefault: f.isDefault }))}
          initial={JSON.parse(
            JSON.stringify({
              campaign: campaignToAdmin(campaign, funnelOf(rows, campaign.trackOpens)),
              recipients: rows.map((r) => recipientToAdmin(project, r)),
              customers: customersWithEmail(project.id).slice(0, 2000),
            }),
          )}
        />
      </main>
    </>
  );
}
