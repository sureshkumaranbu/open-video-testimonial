import { getCampaign } from "@/lib/campaigns";
import { getProjectById } from "@/lib/testimonials";

/** The campaign and its project, or null (then the route answers 404). */
export function campaignAndProject(id: string) {
  const campaign = getCampaign(id);
  const project = campaign && getProjectById(campaign.projectId);
  return campaign && project ? { campaign, project } : null;
}
