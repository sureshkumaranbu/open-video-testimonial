import { asc, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Answer, Project, TestimonialImage } from "@/db/schema";
import { env } from "./env";
import { mediaUrl } from "./storage";
import type { TestimonialWithTags } from "./testimonials";

export const API_STATUSES = ["pending", "approved", "rejected", "withdrawn", "hidden", "trashed"] as const;
export type ApiStatus = (typeof API_STATUSES)[number];

export function apiStatus(t: Pick<TestimonialWithTags, "status" | "withdrawnAt">): ApiStatus {
  return t.withdrawnAt ? "withdrawn" : t.status;
}

/** A testimonial's answers to further questions and its images, which toApi() lists. */
export type ApiExtras = {
  answers: Pick<Answer, "questionKey" | "questionTitle" | "text" | "position">[];
  images: Pick<TestimonialImage, "key" | "alt" | "position">[];
};

/** The extras of many testimonials in two queries, for lists. */
export function apiExtras(ids: string[]): Map<string, ApiExtras> {
  const byId = new Map<string, ApiExtras>(ids.map((id) => [id, { answers: [], images: [] }]));
  if (!ids.length) return byId;
  const db = getDb();
  const { answers, testimonialImages } = schema;
  const answerRows = db
    .select({
      testimonialId: answers.testimonialId,
      questionKey: answers.questionKey,
      questionTitle: answers.questionTitle,
      text: answers.text,
      position: answers.position,
    })
    .from(answers)
    .where(inArray(answers.testimonialId, ids))
    .orderBy(asc(answers.position))
    .all();
  for (const a of answerRows) byId.get(a.testimonialId)?.answers.push(a);
  const imageRows = db
    .select({
      testimonialId: testimonialImages.testimonialId,
      key: testimonialImages.key,
      alt: testimonialImages.alt,
      position: testimonialImages.position,
    })
    .from(testimonialImages)
    .where(inArray(testimonialImages.testimonialId, ids))
    .orderBy(asc(testimonialImages.position))
    .all();
  for (const i of imageRows) byId.get(i.testimonialId)?.images.push(i);
  return byId;
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * The testimonial as the REST API and webhooks describe it. Unlike the public
 * widget feed, this is for the owner's own systems, so it includes the
 * author's email and phone, moderation state, consent details and the private
 * custom and hidden fields. URLs are absolute. Lists pass `extras` from
 * apiExtras(); otherwise they're looked up.
 */
export function toApi(t: TestimonialWithTags, extras: ApiExtras = apiExtras([t.id]).get(t.id)!) {
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
    /** The form it was sent through; null for API, manual and imported ones. */
    formId: t.formId,
    /** "withdrawn" once the author withdrew consent (stored as rejected, and never publishable again). */
    status: apiStatus(t),
    rating: t.rating,
    headline: t.headline,
    text: t.text,
    /** Machine transcript of the video (editable by the owner), if any. */
    transcript: t.transcript,
    /** The question the text or video answers, as it was asked. */
    primaryQuestion: t.primaryQuestion,
    /** Answers to the form's further questions (their videos stay private to the owner). */
    answers: extras.answers.map((a) => ({ key: a.questionKey, title: a.questionTitle, text: a.text })),
    images: extras.images.map((i) => ({ url: abs(i.key)!, alt: i.alt })),
    author: {
      name: t.authorName,
      email: t.authorEmail,
      phone: t.authorPhone,
      title: t.authorTitle,
      company: t.authorCompany,
      website: t.authorWebsite,
      socials: parseObject(t.authorSocials),
      avatarUrl: abs(t.avatarKey),
      companyLogoUrl: abs(t.companyLogoKey),
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
    /** Where the review was first posted (google, trustpilot…), for imports. */
    platform: t.platform,
    sourceUrl: t.sourceUrl,
    /** When it was first posted there, as exactly as datePrecision says. */
    sourceDate: t.sourceDate?.toISOString() ?? null,
    datePrecision: t.datePrecision,
    language: t.language,
    customFields: parseObject(t.customFields),
    hiddenFields: parseObject(t.hiddenFields),
    featured: t.isFeatured,
    pinOrder: t.pinOrder,
    requested: Boolean(t.requestId),
    /** While approved: "owner" (the dashboard), "api" or "auto" (the form's auto-approve rule). */
    approvedBy: t.status === "approved" ? t.approvedBy : null,
    approvedAt: t.status === "approved" ? (t.approvedAt?.toISOString() ?? null) : null,
    consent: {
      at: t.consentAt.toISOString(),
      scopes,
      /** false when the author asked to keep it private: it's never published. */
      public: t.consentPublic,
      editedAfterConsent: t.editedAfterConsent,
      withdrawnAt: t.withdrawnAt?.toISOString() ?? null,
    },
    trashedAt: t.trashedAt?.toISOString() ?? null,
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
