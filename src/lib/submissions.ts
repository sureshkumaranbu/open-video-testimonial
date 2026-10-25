import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Form, Project } from "@/db/schema";
import { maybeAutoApprove } from "./auto-approve";
import { grantConsent, withdrawUrl, type ConsentScope } from "./consent";
import { upsertCustomer } from "./customers";
import { insertAnswers, type NewAnswer } from "./answers";
import { insertFeedback } from "./feedback";
import {
  buildSubmissionSchema,
  formSubmissionSchema,
  isQuestion,
  pickPrimary,
  tagsFromSubmission,
  thankYouFor,
  type FormSubmission,
  type ThankYou,
} from "./forms/engine";
import { fillLabel, resolveLabels } from "./forms/labels";
import { parseFormRow, type FormConfig } from "./forms/schema";
import { insertImages, MAX_IMAGES_PER_QUESTION, type NewImage } from "./images";
import { emitEvent, emitTestimonialEvent } from "./webhooks";
import { queueAnswerVideo, queueVideoProcessing } from "./media";
import { clientIp, clientKey, rateLimit } from "./rate-limit";
import { findRequestByToken, markResponded, queueThankYou } from "./requests";
import { deleteObject, saveUpload, UploadError } from "./storage";
import { createTestimonial, getTestimonial, updateTestimonial } from "./testimonials";
import { claimUpload, getUpload } from "./uploads";
import { firstIssue } from "./validation";

/**
 * The one submission pipeline (WP2.3). The step-by-step form, the embeds and
 * the classic /c page (through legacySubmission) all end here, so every
 * per-form rule (pause, the per-IP cap, auto-tags, auto-approve, the
 * confirmation email and form-scoped webhooks) applies to all of them.
 */

export class SubmissionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type SubmissionFiles = {
  avatar?: File | null;
  companyLogo?: File | null;
  /** Images per question key (at most 3 each, and no more than the question allows). */
  images?: Record<string, File[]>;
  /** The classic page's direct `video` field (before resumable uploads). */
  video?: File | null;
};

export type SubmissionResult = { id: string; message: string; withdrawUrl: string; thankYou: ThankYou };

const DAY = 24 * 60 * 60 * 1000;
const EXPIRED_UPLOAD = "The video upload has expired. Please upload it again.";

/**
 * The classic page's flat multipart fields (already checked by the legacy
 * route) as a submission to the default form: the text or video answers its
 * one question.
 */
export function legacySubmission(
  form: Form,
  fields: Record<string, string | number | undefined>,
): FormSubmission {
  const cfg = parseFormRow(form);
  const key = cfg.pages.filter(isQuestion).find((q) => q.primary)?.key ?? "q1";
  const str = (k: string) => (typeof fields[k] === "string" && fields[k] ? (fields[k] as string) : undefined);
  return formSubmissionSchema.parse({
    rating: typeof fields.rating === "number" ? fields.rating : undefined,
    answers: [{ key, text: str("text"), videoUpload: str("videoUpload"), videoUploadToken: str("videoUploadToken") }],
    person: { name: str("name") ?? "", email: str("email"), title: str("title"), company: str("company") },
    consent: { agreed: true, public: true, scopes: fields.consentSocial ? ["social"] : [] },
    consentVersion: str("consentVersion"),
    requestToken: str("requestToken"),
  });
}

/** The wording the form's consent page shows (empty = the locale's default), with the project's name in. */
export function consentWordingFor(project: Pick<Project, "name">, cfg: FormConfig, language: string): string {
  const page = cfg.pages.find((p) => p.type === "consent");
  const text = (page?.type === "consent" && page.text.trim()) || resolveLabels(language, cfg.labels.overrides).consentDefault;
  return text.replaceAll("{project}", project.name);
}

/**
 * Stores a submission. Order: paused (409, the closed message) → the form's
 * rules check the input → the per-IP cap → uploads are claimed and files
 * saved → customer → testimonial → answers, images and feedback in one
 * transaction → tags (quietly) → consent → request link responded → events →
 * media jobs or auto-approve → the receipt (request links only). Every saved
 * file is deleted again if anything fails.
 *
 * `legacy` is the classic page's endpoint: the route already applied its own
 * checks, so the form's stricter rules (required custom fields…) aren't
 * re-applied, and the message stays the project's thank-you text.
 */
export async function submitForm(a: {
  project: Project;
  form: Form;
  input: unknown;
  files: SubmissionFiles;
  req: Request;
  legacy?: boolean;
}): Promise<SubmissionResult> {
  const { project, form, files, req } = a;
  const cfg = parseFormRow(form);
  const labels = resolveLabels(form.language, cfg.labels.overrides);
  if (form.status === "paused") {
    throw new SubmissionError(409, cfg.settings.closedMessage.trim() || fillLabel(labels.closedMessage, { project: project.name }));
  }

  const parsed = a.legacy ? formSubmissionSchema.safeParse(a.input) : buildSubmissionSchema(cfg, labels).safeParse(a.input);
  if (!parsed.success) throw new SubmissionError(400, firstIssue(parsed.error));
  const input = parsed.data;

  const cap = cfg.settings.maxPerIpPerDay;
  if (cap && !rateLimit(`form-ip:${form.id}:${clientKey(req)}`, cap, DAY)) {
    throw new SubmissionError(429, "You've already sent the most testimonials this form takes from one place today. Thank you!");
  }

  const questions = cfg.pages.filter(isQuestion);
  const picked = pickPrimary(cfg, input.answers);
  // The classic page may send its video as a plain file: then it answers the main question.
  const mainQuestion = questions.find((q) => q.primary) ?? questions[0];
  const primary = picked ?? (files.video && mainQuestion ? { questionKey: mainQuestion.key, question: mainQuestion, text: undefined } : null);
  if (!primary) throw new SubmissionError(400, labels.errorRequired);

  // Check every upload before claiming any, so a bad one consumes nothing.
  const uploads = new Map<string, NonNullable<ReturnType<typeof getUpload>>>();
  for (const ans of input.answers) {
    if (!ans.videoUpload) continue;
    const upload = getUpload(ans.videoUpload, ans.videoUploadToken ?? null);
    if (!upload || upload.kind !== "video" || upload.projectId !== project.id) throw new SubmissionError(400, EXPIRED_UPLOAD);
    uploads.set(ans.key, upload);
  }

  const saved: string[] = [];
  let testimonialId: string | null = null;
  /** Set once the submission is stored: from then on a failure must not undo it. */
  let stored = false;
  try {
    const videos = new Map<string, { key: string; mime: string }>();
    for (const [key, upload] of uploads) {
      const stored = await claimUpload(upload, "video");
      saved.push(stored.key);
      videos.set(key, stored);
    }
    if (files.video) {
      const stored = await saveUpload(files.video, "video");
      saved.push(stored.key);
      videos.set(primary.questionKey, stored);
    }
    const avatar = files.avatar ? await saveUpload(files.avatar, "image") : null;
    if (avatar) saved.push(avatar.key);
    const logo = files.companyLogo ? await saveUpload(files.companyLogo, "image") : null;
    if (logo) saved.push(logo.key);
    const images: NewImage[] = [];
    for (const q of questions) {
      const picked = (files.images?.[q.key] ?? []).slice(0, Math.min(MAX_IMAGES_PER_QUESTION, q.allowImages));
      for (const file of picked) {
        const stored = await saveUpload(file, "image");
        saved.push(stored.key);
        images.push({ questionKey: q.key, key: stored.key });
      }
    }

    // A personal request link: connect the two and stop the reminders.
    const request = input.requestToken ? findRequestByToken(input.requestToken) : null;
    const fromRequest = request?.projectId === project.id ? request : null;
    const person = input.person;
    const website = "authorWebsite" in input ? input.authorWebsite : undefined;
    const customer = upsertCustomer(project.id, {
      email: person.email,
      name: person.name,
      title: person.title,
      company: person.company,
      website,
      avatarKey: avatar?.key,
      socials: person.socials,
    });
    const primaryKey = primary.questionKey;
    const mainVideo = videos.get(primaryKey);
    const testimonial = createTestimonial(
      project.id,
      {
        name: person.name,
        email: person.email,
        title: person.title,
        company: person.company,
        rating: input.rating,
        text: primary.text,
        videoKey: mainVideo?.key,
        videoMime: mainVideo?.mime,
        avatarKey: avatar?.key,
        requestId: fromRequest?.id,
        formId: form.id,
        customerId: customer?.id ?? null,
        authorWebsite: website,
        authorPhone: person.phone,
        authorSocials: person.socials as Record<string, string> | undefined,
        companyLogoKey: logo?.key,
        language: a.legacy ? undefined : form.language,
        primaryQuestion: primary.question.title,
        customFields: input.customFields,
        hiddenFields: input.hiddenFields,
        consentPublic: input.consent.public,
      },
      { source: "form" },
    );
    testimonialId = testimonial.id;

    const answerRows: NewAnswer[] = questions.flatMap((q, position) => {
      if (q.key === primaryKey) return [];
      const ans = input.answers.find((x) => x.key === q.key);
      const video = videos.get(q.key);
      if (!ans?.text && !video) return [];
      return [
        {
          questionKey: q.key,
          questionTitle: q.title,
          position,
          text: ans?.text ?? null,
          videoKey: video?.key ?? null,
          videoMime: video?.mime ?? null,
          videoOriginalKey: video?.key ?? null,
        },
      ];
    });
    const feedbackPages = cfg.pages.filter((p) => p.type === "feedback");
    const { answers: storedAnswers, notes } = getDb().transaction((tx) => ({
      answers: insertAnswers(tx, testimonial.id, answerRows),
      images: insertImages(tx, testimonial.id, images),
      notes: insertFeedback(
        tx,
        project.id,
        input.feedback
          .filter((f) => feedbackPages.some((p) => p.type === "feedback" && p.key === f.key))
          .map((f) => ({
            formId: form.id,
            customerId: customer?.id ?? null,
            testimonialId: testimonial.id,
            rating: input.rating ?? null,
            text: f.text,
            authorName: person.name,
            authorEmail: person.email ?? null,
          })),
      ),
    }));

    const tags = tagsFromSubmission(cfg, input.customFields);
    if (tags.length) updateTestimonial(testimonial.id, { tags }, { quiet: true });
    const token = grantConsent({
      testimonialId: testimonial.id,
      project,
      versionId: input.consentVersion,
      // The classic page shows the project's own wording, as before.
      wording: a.legacy ? undefined : consentWordingFor(project, cfg, form.language),
      scopes: input.consent.scopes as ConsentScope[],
      public: input.consent.public,
      actor: "customer",
      ip: clientIp(req),
    });
    if (fromRequest) markResponded(fromRequest, testimonial.id);
    stored = true;

    const created = getTestimonial(testimonial.id);
    emitTestimonialEvent("testimonial.created", created);
    emitEvent(
      "form.submitted",
      project,
      { form: { id: form.id, slug: form.slug, name: form.name }, testimonialId: testimonial.id, hiddenFields: input.hiddenFields },
      { formId: form.id },
    );
    for (const note of notes) {
      emitEvent("feedback.created", project, { feedback: { id: note.id, formId: form.id, testimonialId: testimonial.id, rating: note.rating, text: note.text, createdAt: note.createdAt.toISOString() } }, { formId: form.id });
    }

    // Videos are checked again once processed; auto-approve waits for every one of them.
    for (const answer of storedAnswers) if (answer.videoKey) await queueAnswerVideo(answer.id, { autoApprove: true });
    if (mainVideo) await queueVideoProcessing(testimonial.id, { autoApprove: true });
    else maybeAutoApprove(testimonial.id);

    const url = withdrawUrl(token);
    queueThankYou(project, fromRequest, url, form);
    const thankYou = thankYouFor(cfg, input.rating);
    const message = a.legacy
      ? project.thankYouMessage
      : fillLabel(thankYou.message || labels.thankYouMessage, { project: project.name });
    return { id: testimonial.id, message, withdrawUrl: url, thankYou };
  } catch (err) {
    if (stored) throw err;
    // Nothing half-stored: the row (cascading to answers, images and feedback links) and every file go.
    if (testimonialId) getDb().delete(schema.testimonials).where(eq(schema.testimonials.id, testimonialId)).run();
    await Promise.all(saved.map((key) => deleteObject(key)));
    if (err instanceof UploadError) throw new SubmissionError(400, err.message);
    throw err;
  }
}
