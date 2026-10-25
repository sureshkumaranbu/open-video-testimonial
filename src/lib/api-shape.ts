import type { Project } from "@/db/schema";
import { env } from "./env";
import { mediaUrl } from "./storage";
import type { TestimonialWithTags } from "./testimonials";

export const API_STATUSES = ["pending", "approved", "rejected", "withdrawn", "hidden", "trashed"] as const;
export type ApiStatus = (typeof API_STATUSES)[number];

export function apiStatus(t: Pick<TestimonialWithTags, "status" | "withdrawnAt">): ApiStatus {
  return t.withdrawnAt ? "withdrawn" : t.status;
}

/**
 * The testimonial as the REST API and webhooks describe it. Unlike the public
 * widget feed, this is for the owner's own systems, so it includes the
 * author's email, moderation state and consent details. URLs are absolute.
 */
export function toApi(t: TestimonialWithTags) {
  const abs = (key: string | null) => (key ? `${env.publicUrl}${mediaUrl(key)}` : null);
  let scopes: string[] = [];
  try {
    scopes = JSON.parse(t.consentScopes);
  } catch {
    // leave empty
  }
  return {
    id: t.id,
    projectId: t.projectId,
    /** "withdrawn" once the author withdrew consent (stored as rejected, and never publishable again). */
    status: apiStatus(t),
    rating: t.rating,
    text: t.text,
    /** Machine transcript of the video (editable by the owner), if any. */
    transcript: t.transcript,
    author: {
      name: t.authorName,
      email: t.authorEmail,
      title: t.authorTitle,
      company: t.authorCompany,
      avatarUrl: abs(t.avatarKey),
    },
    video: t.videoKey
      ? {
          url: abs(t.videoKey),
          mime: t.videoMime,
          originalUrl: abs(t.videoOriginalKey),
          posterUrl: abs(t.posterKey),
          captionsUrl: t.captionsVtt ? `${env.publicUrl}/api/captions/${t.id}` : null,
          durationMs: t.videoDurationMs,
          width: t.videoWidth,
          height: t.videoHeight,
          processing: t.mediaStatus,
        }
      : null,
    tags: t.tags,
    source: t.source,
    requested: Boolean(t.requestId),
    /** While approved: "owner" (the dashboard), "api" or "auto" (the project's auto-approve rule). */
    approvedBy: t.approvedBy,
    approvedAt: t.approvedAt?.toISOString() ?? null,
    consent: {
      at: t.consentAt.toISOString(),
      scopes,
      editedAfterConsent: t.editedAfterConsent,
      withdrawnAt: t.withdrawnAt?.toISOString() ?? null,
    },
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export type ApiTestimonial = ReturnType<typeof toApi>;

export function projectToApi(p: Project) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    collectUrl: `${env.publicUrl}/c/${p.slug}`,
    wallUrl: `${env.publicUrl}/wall/${p.slug}`,
    autoApprove: { enabled: p.autoApprove, minRating: p.autoApproveMinRating, includeVideo: p.autoApproveVideo },
    createdAt: p.createdAt.toISOString(),
  };
}
