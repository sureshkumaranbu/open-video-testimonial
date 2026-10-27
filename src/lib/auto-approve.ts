import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MediaStatus, Project, Testimonial } from "@/db/schema";
import { autoApproveRuleFor } from "./forms";
import type { AutoApproveRule } from "./forms/schema";
import { getProjectById, getTestimonial, updateTestimonial } from "./testimonials";

/**
 * Optional auto-approve, set per form (the default form's rule mirrors the
 * project's settings) and off by default. A new testimonial from a form (or a
 * personal request link) goes live without a click when it matches the rule:
 * everything, enough stars, text only, or anything the author agreed to make
 * public. In every mode its text must have no links, and a video counts only
 * when the owner included videos and processing has finished. Everything else
 * waits in Pending as before. Approving goes through updateTestimonial, the
 * same path as the dashboard's Approve button, so webhooks and the public
 * pages behave exactly as for a manual approve.
 */

type Settings = Pick<Project, "autoApprove" | "autoApproveMinRating" | "autoApproveVideo" | "autoApproveSince">;
type Candidate = Pick<Testimonial, "status" | "source" | "rating" | "text" | "videoKey" | "mediaStatus" | "withdrawnAt" | "createdAt"> &
  Partial<Pick<Testimonial, "consentPublic">>;

export type AutoApproveDecision = { approve: true; rule: string } | { approve: false; reason: string };

/** Only the public collection form, which request links also use. CSV, API and project imports keep their own status. */
const SOURCES = ["form"];

/** http://, https:// or www., so spam with a link doesn't go live by itself. */
export const hasLink = (text: string | null) => Boolean(text) && /https?:\/\/|\bwww\./i.test(text!);

/** The rule as the dashboard shows it: "4+ stars" or "5 stars". */
export function autoApproveRule(p: Pick<Project, "autoApproveMinRating">) {
  return p.autoApproveMinRating >= 5 ? "5 stars" : `${p.autoApproveMinRating}+ stars`;
}

/** Any rule as the dashboard's history line shows it. */
export function ruleLabel(rule: AutoApproveRule) {
  switch (rule.mode) {
    case "all":
      return "every testimonial";
    case "text":
      return "text only";
    case "public":
      return "public consent";
    default:
      return autoApproveRule({ autoApproveMinRating: rule.minRating });
  }
}

/** The project's own settings as a rule: what the default form's rule mirrors (D2). */
export function ruleFromProject(p: Settings): AutoApproveRule {
  return {
    mode: p.autoApprove ? "rating" : "off",
    minRating: p.autoApproveMinRating as AutoApproveRule["minRating"],
    includeVideo: p.autoApproveVideo,
    since: p.autoApproveSince,
  };
}

/**
 * Whether a testimonial matches a rule, and if not, why not (shown to the
 * owner). `answerMedia` is the status of each video answering a further
 * question: those are held to the same rule as the main video, and every one
 * must be ready first (WP2.3 pendingMedia).
 */
export function checkRule(rule: AutoApproveRule, t: Candidate, o: { answerMedia?: MediaStatus[] } = {}): AutoApproveDecision {
  const no = (reason: string) => ({ approve: false as const, reason });
  if (rule.mode === "off" || !rule.since) return no("auto-approve is off");
  if (!SOURCES.includes(t.source)) return no(`added by ${t.source}, not the collection form`);
  if (t.createdAt.getTime() < rule.since.getTime()) return no("sent before auto-approve was turned on");
  if (t.withdrawnAt) return no("withdrawn");
  if (t.status !== "pending") return no(`already ${t.status}`);
  if (t.consentPublic === false) return no("the author asked to keep it private");
  if (rule.mode === "rating") {
    if (t.rating == null) return no("no rating");
    if (t.rating < rule.minRating) return no(`rated ${t.rating}, below ${rule.minRating}`);
  }
  if (hasLink(t.text)) return no("the text contains a link");
  if (rule.mode === "text") {
    if (t.videoKey) return no("only text testimonials are approved automatically");
    if (!t.text?.trim()) return no("no text");
  }
  if (t.videoKey) {
    if (!rule.includeVideo) return no("videos aren't included");
    if (t.mediaStatus === "failed" || t.mediaStatus === "skipped") return no("the video couldn't be processed");
    if (t.mediaStatus !== "ready") return no("the video is still processing");
  }
  const answerMedia = o.answerMedia ?? [];
  if (answerMedia.length) {
    if (rule.mode === "text") return no("only text testimonials are approved automatically");
    if (!rule.includeVideo) return no("videos aren't included");
    if (answerMedia.some((m) => m === "failed" || m === "skipped")) return no("a video answer couldn't be processed");
    if (answerMedia.some((m) => m !== "ready")) return no("a video answer is still processing");
  }
  return { approve: true, rule: ruleLabel(rule) };
}

/** The project's rule, exactly as before forms (kept with the same reasons for the dashboard and tests). */
export function checkAutoApprove(p: Settings, t: Candidate): AutoApproveDecision {
  return checkRule(ruleFromProject(p), t);
}

/**
 * The rule for a testimonial: its form's, or the default form's when it has
 * none. A default form still at config_version 0 is described by the project
 * columns (src/lib/forms/defaults.ts formConfigFromProject), so its rule is the
 * project's; once a form has its own config, the form decides (D3).
 */
export function ruleFor(t: Pick<Testimonial, "formId" | "projectId">, project: Settings): AutoApproveRule {
  const { forms } = schema;
  const form = getDb()
    .select({ configVersion: forms.configVersion })
    .from(forms)
    .where(t.formId ? eq(forms.id, t.formId) : and(eq(forms.projectId, t.projectId), eq(forms.isDefault, true)))
    .get();
  return form && form.configVersion > 0 ? autoApproveRuleFor(t) : ruleFromProject(project);
}

/**
 * Applies the rule to a testimonial as it stands now. Called once for each
 * new submission, and again when its video has finished processing.
 */
export function maybeAutoApprove(testimonialId: string) {
  const t = getTestimonial(testimonialId);
  const project = t && getProjectById(t.projectId);
  if (!t || !project) return null;
  const { answers } = schema;
  const answerMedia = getDb()
    .select({ status: answers.mediaStatus })
    .from(answers)
    .where(and(eq(answers.testimonialId, t.id), isNotNull(answers.videoKey)))
    .all()
    .map((a) => a.status);
  const decision = checkRule(ruleFor(t, project), t, { answerMedia });
  if (!decision.approve) return null;
  return updateTestimonial(t.id, { status: "approved" }, { actor: "auto", rule: decision.rule });
}
