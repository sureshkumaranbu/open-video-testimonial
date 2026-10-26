import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { logConsentEvent } from "./consent";
import { upsertCustomer } from "./customers";
import { insertImages } from "./images";
import { queueVideoProcessing } from "./media";
import { deleteObject, saveUpload } from "./storage";
import { createTestimonial, getTestimonial, updateTestimonial, type TestimonialWithTags } from "./testimonials";
import { claimUpload, getUpload } from "./uploads";
import { testimonialUpdateSchema } from "./validation";

/**
 * Adding a testimonial by hand (PRD §8.1): one the owner received somewhere
 * else (an email, a call, a screenshot of a review). It goes in as approved
 * unless they pick another status, without webhooks or auto-approve, and
 * the consent ledger records that consent was collected outside Plaudit.
 */

export const MAX_MANUAL_IMAGES = 5;
export const MANUAL_KINDS = ["text", "video", "image"] as const;
export const MANUAL_CONSENT_DETAIL = "Added in the dashboard; consent was collected outside Plaudit";

const edit = testimonialUpdateSchema.shape;

export const manualInputSchema = z
  .object({
    /** Which tab of the dialog it came from; only decides what's required. */
    kind: z.enum(MANUAL_KINDS).default("text"),
    name: z.string().trim().min(1).max(120),
    title: edit.authorTitle,
    company: edit.authorCompany,
    email: z.email().max(200).optional().or(z.literal("").transform(() => undefined)),
    authorWebsite: edit.authorWebsite,
    rating: edit.rating,
    headline: edit.headline,
    text: edit.text,
    platform: edit.platform,
    sourceUrl: edit.sourceUrl,
    sourceDate: edit.sourceDate,
    datePrecision: edit.datePrecision,
    language: edit.language,
    tags: edit.tags,
    status: z.enum(["approved", "pending", "hidden", "rejected"]).default("approved"),
  })
  .refine((v) => v.kind !== "text" || Boolean(v.text?.trim()), { message: "Add the testimonial's text", path: ["text"] });
export type ManualInput = z.input<typeof manualInputSchema>;

/** A manual add that can't be saved as asked. */
export class ManualAddError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ManualFiles = {
  avatar?: File | null;
  companyLogo?: File | null;
  images?: File[];
  /** A finished resumable upload (POST /api/admin/uploads with kind "video"). */
  videoUpload?: { id: string; token: string } | null;
};

export async function addManualTestimonial(project: Project, raw: ManualInput, files: ManualFiles = {}, by?: string): Promise<TestimonialWithTags> {
  const parsed = manualInputSchema.safeParse(raw);
  if (!parsed.success) throw new ManualAddError(400, parsed.error.issues[0]?.message ?? "Check the form and try again");
  const input = parsed.data;
  const images = files.images ?? [];
  if (images.length > MAX_MANUAL_IMAGES) throw new ManualAddError(400, `Attach at most ${MAX_MANUAL_IMAGES} images`);
  const upload = files.videoUpload ? getUpload(files.videoUpload.id, files.videoUpload.token) : null;
  if (files.videoUpload && (!upload || upload.kind !== "video" || upload.projectId !== project.id)) {
    throw new ManualAddError(400, "That video upload has expired or belongs elsewhere. Choose the file again.");
  }
  if (input.kind === "video" && !upload) throw new ManualAddError(400, "Choose the video file");
  if (input.kind === "image" && !images.length) throw new ManualAddError(400, "Attach the screenshot or image");
  if (!input.text?.trim() && !upload && !images.length) throw new ManualAddError(400, "Add the text, a video or an image");

  const saved: string[] = [];
  let id: string | null = null;
  try {
    const video = upload ? await claimUpload(upload, "video") : null;
    if (video) saved.push(video.key);
    const avatar = files.avatar ? await saveUpload(files.avatar, "image") : null;
    if (avatar) saved.push(avatar.key);
    const logo = files.companyLogo ? await saveUpload(files.companyLogo, "image") : null;
    if (logo) saved.push(logo.key);
    const stored: string[] = [];
    for (const file of images) {
      const s = await saveUpload(file, "image");
      saved.push(s.key);
      stored.push(s.key);
    }

    const customer = input.email
      ? upsertCustomer(project.id, {
          email: input.email,
          name: input.name,
          title: input.title ?? undefined,
          company: input.company ?? undefined,
          website: input.authorWebsite ?? undefined,
          avatarKey: avatar?.key,
        })
      : null;
    const t = createTestimonial(
      project.id,
      {
        name: input.name,
        email: input.email,
        title: input.title ?? undefined,
        company: input.company ?? undefined,
        rating: input.rating ?? undefined,
        text: input.text?.trim() || undefined,
        headline: input.headline ?? undefined,
        authorWebsite: input.authorWebsite ?? undefined,
        avatarKey: avatar?.key,
        companyLogoKey: logo?.key,
        videoKey: video?.key,
        videoMime: video?.mime,
        platform: input.platform ?? undefined,
        sourceUrl: input.sourceUrl ?? undefined,
        sourceDate: input.sourceDate ?? undefined,
        datePrecision: input.datePrecision,
        language: input.language ?? undefined,
        customerId: customer?.id ?? null,
      },
      { source: "manual", by },
    );
    id = t.id;
    if (stored.length) {
      getDb().transaction((tx) => insertImages(tx, t.id, stored.map((key) => ({ questionKey: null, key }))));
    }
  } catch (err) {
    // Nothing half-saved: the row (if it was created) and every stored file go.
    if (id) getDb().delete(schema.testimonials).where(eq(schema.testimonials.id, id)).run();
    await Promise.all(saved.map((key) => deleteObject(key).catch(() => undefined)));
    throw err;
  }

  logConsentEvent({ testimonialId: id, type: "imported", actor: "owner", detail: MANUAL_CONSENT_DETAIL });
  // Quiet: adding your own testimonial isn't news for your webhooks.
  if (input.status !== "pending" || input.tags?.length) {
    updateTestimonial(id, { status: input.status, tags: input.tags }, { quiet: true, by, actor: "owner" });
  }
  // The usual pipeline (poster, mp4, captions). Manual rows never auto-approve.
  if (upload) await queueVideoProcessing(id);
  return getTestimonial(id)!;
}
