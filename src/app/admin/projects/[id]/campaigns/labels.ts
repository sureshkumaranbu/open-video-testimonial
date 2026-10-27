import type { CampaignStatus } from "@/db/schema";
import type { InviteStage } from "@/lib/requests";

/** Words for a campaign's state and each recipient's step, shared by the list and the campaign page. */
export const STATUS_LABEL: Record<CampaignStatus, string> = { draft: "Draft", active: "Sending", paused: "Paused" };

export const STAGE_LABEL: Record<InviteStage, string> = {
  not_sent: "Not sent",
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
  bounced: "Bounced",
  opened: "Opened",
  clicked: "Clicked",
  started: "Started",
  submitted: "Responded",
  declined: "Declined",
  unsubscribed: "Unsubscribed",
};
