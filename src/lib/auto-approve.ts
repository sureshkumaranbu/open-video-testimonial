import type { Project, Testimonial } from "@/db/schema";
import { getProjectById, getTestimonial, updateTestimonial } from "./testimonials";

/**
 * Optional auto-approve, set per project and off by default. A new testimonial
 * from the public form (or a personal request link) goes live without a click
 * when it has enough stars, no links in its text and, for videos, when the
 * owner included videos and processing has finished. Everything else waits
 * in Pending as before. Approving goes through updateTestimonial, the same
 * path as the dashboard's Approve button, so webhooks and the public pages
 * behave exactly as for a manual approve.
 */

type Settings = Pick<Project, "autoApprove" | "autoApproveMinRating" | "autoApproveVideo" | "autoApproveSince">;
type Candidate = Pick<Testimonial, "status" | "source" | "rating" | "text" | "videoKey" | "mediaStatus" | "withdrawnAt" | "createdAt">;

export type AutoApproveDecision = { approve: true; rule: string } | { approve: false; reason: string };

/** Only the public collection form, which request links also use. CSV, API and project imports keep their own status. */
const SOURCES = ["form"];

/** http://, https:// or www., so spam with a link doesn't go live by itself. */
export const hasLink = (text: string | null) => Boolean(text) && /https?:\/\/|\bwww\./i.test(text!);

/** The rule as the dashboard shows it: "4+ stars" or "5 stars". */
export function autoApproveRule(p: Pick<Project, "autoApproveMinRating">) {
  return p.autoApproveMinRating >= 5 ? "5 stars" : `${p.autoApproveMinRating}+ stars`;
}

export function checkAutoApprove(p: Settings, t: Candidate): AutoApproveDecision {
  const no = (reason: string) => ({ approve: false as const, reason });
  if (!p.autoApprove || !p.autoApproveSince) return no("auto-approve is off");
  if (!SOURCES.includes(t.source)) return no(`added by ${t.source}, not the collection form`);
  if (t.createdAt.getTime() < p.autoApproveSince.getTime()) return no("sent before auto-approve was turned on");
  if (t.withdrawnAt) return no("withdrawn");
  if (t.status !== "pending") return no(`already ${t.status}`);
  if (t.rating == null) return no("no rating");
  if (t.rating < p.autoApproveMinRating) return no(`rated ${t.rating}, below ${p.autoApproveMinRating}`);
  if (hasLink(t.text)) return no("the text contains a link");
  if (t.videoKey) {
    if (!p.autoApproveVideo) return no("videos aren't included");
    if (t.mediaStatus === "failed" || t.mediaStatus === "skipped") return no("the video couldn't be processed");
    if (t.mediaStatus !== "ready") return no("the video is still processing");
  }
  return { approve: true, rule: autoApproveRule(p) };
}

/**
 * Applies the project's rule to a testimonial as it stands now. Called once
 * for each new submission, and again when its video has finished processing.
 */
export function maybeAutoApprove(testimonialId: string) {
  const t = getTestimonial(testimonialId);
  const project = t && getProjectById(t.projectId);
  if (!t || !project) return null;
  const decision = checkAutoApprove(project, t);
  if (!decision.approve) return null;
  return updateTestimonial(t.id, { status: "approved" }, { actor: "auto", rule: decision.rule });
}
