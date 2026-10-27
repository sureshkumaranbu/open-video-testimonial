import { z } from "zod";
import { fillLabel, resolveLabels, type Labels } from "./labels";
import {
  fieldKeySchema,
  FORM_CONSENT_SCOPES,
  MAX_QUESTIONS,
  type CustomField,
  type FormConfig,
  type FormPage,
  type QuestionPage,
} from "./schema";

/**
 * The step engine (FORM-03..07): which pages a person sees, what each step
 * needs before Continue, and the one submission shape the runner sends and
 * the server checks against the form. Pure and client-safe, so both sides
 * apply exactly the same rules.
 */

export const SOCIAL_KEYS = ["x", "linkedin", "instagram", "tiktok"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

/** The standard "about you" details a link may prefill (?name=…). */
export const PERSON_KEYS = ["name", "email", "title", "company", "website", "phone"] as const;
export type PersonKey = (typeof PERSON_KEYS)[number];

export type PersonState = Record<PersonKey, string> & { socials: Partial<Record<SocialKey, string>> };

export type AnswerState = {
  /** What the person chose for a "video or text" question. */
  mode: "text" | "video";
  text: string;
  /** A take is recorded (or picked) for this question. */
  hasVideo: boolean;
  /** Its video has finished uploading. */
  videoReady: boolean;
  images: number;
};

/** Everything the runner holds while someone fills the form in (files are kept beside it). */
export type Answers = {
  rating: number;
  answers: Record<string, AnswerState>;
  feedback: Record<string, string>;
  person: PersonState;
  custom: Record<string, string | boolean>;
  consent: { agreed: boolean; public: boolean; scopes: string[] };
  hasPhoto: boolean;
  hasLogo: boolean;
};

const PREFILL_MAX_KEYS = 20;
const PREFILL_MAX_CHARS = 200;

const answerMode = (q: QuestionPage): AnswerState["mode"] => (q.mode === "video" ? "video" : "text");

/** A fresh state for the form, with any prefilled details. */
export function emptyAnswers(cfg: Pick<FormConfig, "pages">, prefill?: Partial<PersonState>): Answers {
  const answers: Record<string, AnswerState> = {};
  for (const p of cfg.pages) {
    if (p.type === "question") answers[p.key] = { mode: answerMode(p), text: "", hasVideo: false, videoReady: false, images: 0 };
  }
  return {
    rating: 0,
    answers,
    feedback: {},
    person: { name: "", email: "", title: "", company: "", website: "", phone: "", socials: {}, ...prefill },
    custom: {},
    consent: { agreed: false, public: true, scopes: [] },
    hasPhoto: false,
    hasLogo: false,
  };
}

/** Whether a page is shown at all (consent and about you always are). */
export function pageEnabled(p: FormPage): boolean {
  return !("enabled" in p) || p.enabled;
}

/**
 * The steps in order: every enabled page, without the thank-you page (shown
 * after sending). `state` is for branching rules (FORM-12 is P1); today the
 * pages don't depend on the answers.
 */
export function visiblePages(cfg: Pick<FormConfig, "pages">, state?: Answers): FormPage[] {
  void state;
  return cfg.pages.filter((p) => p.type !== "thank_you" && pageEnabled(p));
}

export const isQuestion = (p: FormPage): p is QuestionPage => p.type === "question";

/** The custom fields of the enabled about pages. */
export function customFields(cfg: Pick<FormConfig, "pages">): CustomField[] {
  return cfg.pages.flatMap((p) =>
    (p.type === "about_you" || (p.type === "about_company" && p.enabled)) ? p.custom : [],
  );
}

// ----------------------------------------------------------------- checks

const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isUrl = (v: string) => URL_RE.test(v.trim());

/** Why a custom field's value won't do (a label key), or null. */
export function checkCustom(f: CustomField, value: unknown): "errorField" | "errorUrl" | "errorNumber" | null {
  const empty = value === undefined || value === null || value === "" || value === false;
  if (empty) return f.required ? "errorField" : null;
  switch (f.type) {
    case "checkbox":
      return typeof value === "boolean" ? null : "errorField";
    case "url":
      return typeof value === "string" && isUrl(value) && value.length <= 2000 ? null : "errorUrl";
    case "number":
      return Number.isFinite(Number(value)) && String(value).trim() !== "" ? null : "errorNumber";
    case "nps": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 10 ? null : "errorField";
    }
    case "dropdown":
      return typeof value === "string" && (f.options ?? []).some((o) => o.label === value) ? null : "errorField";
    case "short":
      return typeof value === "string" && value.length <= 200 ? null : "errorField";
    case "long":
      return typeof value === "string" && value.length <= 2000 ? null : "errorField";
  }
}

/** Whether a question has an answer it accepts. */
export function answered(q: QuestionPage, a: AnswerState | undefined): boolean {
  if (!a) return false;
  const text = a.text.trim().length > 0;
  if (q.mode === "text") return text;
  if (q.mode === "video") return a.hasVideo;
  return a.mode === "video" ? a.hasVideo : text;
}

/**
 * What stops Continue on this step, keyed by field ({} = fine to go on):
 * `rating`, `q:<key>`, `f:<key>`, the person keys, `c:<custom key>`, `consent`.
 */
export function validateStep(page: FormPage, state: Answers, labels: Labels): Record<string, string> {
  const errors: Record<string, string> = {};
  switch (page.type) {
    case "rating":
      if (page.required && !state.rating) errors.rating = labels.errorRating;
      break;
    case "question": {
      const a = state.answers[page.key];
      if (!answered(page, a)) {
        const wantsVideo = page.mode === "video" || (page.mode === "video_text" && a?.mode === "video");
        if (page.required) errors[`q:${page.key}`] = wantsVideo ? labels.errorVideo : labels.errorRequired;
      }
      // A video still uploading doesn't stop Continue: it keeps going in the background (answer-uploads.ts).
      break;
    }
    case "feedback":
      if (page.required && !state.feedback[page.key]?.trim()) errors[`f:${page.key}`] = labels.errorRequired;
      break;
    case "consent":
      if (!state.consent.agreed) errors.consent = labels.errorConsent;
      break;
    case "about_you": {
      if (!state.person.name.trim()) errors.name = labels.errorName;
      const f = page.fields;
      const email = state.person.email.trim();
      if (f.email.enabled && (email ? !EMAIL_RE.test(email) : f.email.required)) errors.email = email ? labels.errorEmail : labels.errorField;
      for (const k of ["title", "company", "phone"] as const) {
        if (f[k].enabled && f[k].required && !state.person[k].trim()) errors[k] = labels.errorField;
      }
      const site = state.person.website.trim();
      if (f.website.enabled && (site ? !isUrl(site) : f.website.required)) errors.website = site ? labels.errorUrl : labels.errorField;
      if (f.photo.enabled && f.photo.required && !state.hasPhoto) errors.photo = labels.errorField;
      if (f.socials.enabled && f.socials.required && !SOCIAL_KEYS.some((k) => state.person.socials[k]?.trim())) {
        errors.socials = labels.errorField;
      }
      for (const c of page.custom) {
        const problem = checkCustom(c, state.custom[c.key]);
        if (problem) errors[`c:${c.key}`] = labels[problem];
      }
      break;
    }
    case "about_company": {
      const f = page.fields;
      if (f.company.enabled && f.company.required && !state.person.company.trim()) errors.company = labels.errorField;
      const site = state.person.website.trim();
      if (f.website.enabled && (site ? !isUrl(site) : f.website.required)) errors.website = site ? labels.errorUrl : labels.errorField;
      if (f.logo.enabled && f.logo.required && !state.hasLogo) errors.logo = labels.errorField;
      for (const c of page.custom) {
        const problem = checkCustom(c, state.custom[c.key]);
        if (problem) errors[`c:${c.key}`] = labels[problem];
      }
      break;
    }
    default:
      break;
  }
  return errors;
}

// ------------------------------------------------------------- submission

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const submittedAnswer = z.object({
  key: fieldKeySchema,
  text: z.string().max(5000).optional(),
  videoUpload: z.string().max(64).optional(),
  videoUploadToken: z.string().max(200).optional(),
});
export type SubmittedAnswer = z.infer<typeof submittedAnswer>;

/** The JSON `payload` of a form submission (multipart; files ride beside it). */
export const formSubmissionSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  answers: z.array(submittedAnswer).max(MAX_QUESTIONS).default([]),
  feedback: z.array(z.object({ key: fieldKeySchema, text: z.string().max(5000) })).max(10).default([]),
  person: z.object({
    name: z.string().trim().min(1, "Please enter your name").max(120),
    email: z
      .string()
      .trim()
      .max(254)
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.email("Please enter a valid email").optional()),
    title: optionalText(120),
    company: optionalText(120),
    phone: optionalText(40),
    socials: z.partialRecord(z.enum(SOCIAL_KEYS), z.string().trim().max(100)).optional(),
  }),
  /** The author's or their company's site (not `website`: that's the honeypot, D5). */
  authorWebsite: optionalText(2000),
  customFields: z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean()])).default({}),
  hiddenFields: z.record(z.string().max(40), z.string().max(PREFILL_MAX_CHARS)).default({}),
  consent: z.object({
    agreed: z.literal(true, { error: "Please tick the consent box so we can share your testimonial" }),
    public: z.boolean().default(true),
    scopes: z.array(z.enum(FORM_CONSENT_SCOPES)).max(FORM_CONSENT_SCOPES.length).default([]),
  }),
  consentVersion: z.string().max(64).optional(),
  requestToken: z.string().max(100).optional(),
  language: z.string().max(16).optional(),
});
export type FormSubmission = z.output<typeof formSubmissionSchema>;

/**
 * The submission schema for one form: the shape above, then the form's own
 * rules (required questions and fields, each question's answer mode, field
 * types, which consent options exist), and finally only what the form asks
 * for is kept: answers to unknown or disabled questions, fields it doesn't
 * have and link parameters outside its allow-list are dropped. Messages come
 * from `labels` (the form's language).
 */
export function buildSubmissionSchema(cfg: FormConfig, labels: Labels = resolveLabels("en")) {
  const pages = visiblePages(cfg);
  const questions = pages.filter(isQuestion);
  const feedbackPages = pages.filter((p): p is Extract<FormPage, { type: "feedback" }> => p.type === "feedback");
  const fields = customFields(cfg);
  const aboutYou = pages.find((p): p is Extract<FormPage, { type: "about_you" }> => p.type === "about_you");
  const company = pages.find((p): p is Extract<FormPage, { type: "about_company" }> => p.type === "about_company");
  const consent = cfg.pages.find((p): p is Extract<FormPage, { type: "consent" }> => p.type === "consent");
  const rating = pages.find((p): p is Extract<FormPage, { type: "rating" }> => p.type === "rating");

  const keep = (s: FormSubmission) => {
    const answers = questions.flatMap((q) => {
      const a = s.answers.find((x) => x.key === q.key);
      if (!a) return [];
      const text = q.mode === "video" ? undefined : a.text?.trim() || undefined;
      const video = q.mode === "text" ? {} : { videoUpload: a.videoUpload || undefined, videoUploadToken: a.videoUploadToken };
      return text || video.videoUpload ? [{ key: q.key, text, ...video }] : [];
    });
    const asks = (k: "title" | "company" | "phone" | "website") =>
      Boolean(aboutYou?.fields[k as keyof typeof aboutYou.fields]?.enabled) ||
      (company !== undefined && (k === "company" || k === "website") && company.fields[k].enabled);
    return {
      ...s,
      rating: rating ? s.rating : undefined,
      answers,
      feedback: feedbackPages.flatMap((p) => {
        const text = s.feedback.find((f) => f.key === p.key)?.text.trim();
        return text ? [{ key: p.key, text }] : [];
      }),
      person: {
        name: s.person.name,
        email: aboutYou?.fields.email.enabled ? s.person.email : undefined,
        title: asks("title") ? s.person.title : undefined,
        company: asks("company") ? s.person.company : undefined,
        phone: asks("phone") ? s.person.phone : undefined,
        socials: aboutYou?.fields.socials.enabled ? s.person.socials : undefined,
      },
      authorWebsite: asks("website") ? s.authorWebsite : undefined,
      customFields: Object.fromEntries(
        fields.flatMap((f) => {
          const v = s.customFields[f.key];
          if (v === undefined || v === "" || v === false) return [];
          return [[f.key, f.type === "number" || f.type === "nps" ? Number(v) : typeof v === "string" ? v.trim() : v]];
        }),
      ),
      hiddenFields: Object.fromEntries(
        cfg.settings.hiddenFields.flatMap((k) => (s.hiddenFields[k] ? [[k, s.hiddenFields[k]]] : [])),
      ),
      consent: {
        agreed: true as const,
        public: consent?.allowPrivate ? s.consent.public : true,
        scopes: s.consent.scopes.filter((sc) => sc !== "website" && consent?.scopes.includes(sc)),
      },
    };
  };

  return formSubmissionSchema
    .superRefine((s, ctx) => {
      const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
      if (rating?.required && !s.rating) issue(["rating"], labels.errorRating);
      for (const q of questions) {
        const a = s.answers.find((x) => x.key === q.key);
        const hasText = Boolean(a?.text?.trim()) && q.mode !== "video";
        const hasVideo = Boolean(a?.videoUpload) && q.mode !== "text";
        if (q.required && !hasText && !hasVideo) {
          issue(["answers", q.key], `${q.title}: ${q.mode === "video" ? labels.errorVideo : labels.errorRequired}`);
        }
      }
      for (const p of feedbackPages) {
        if (p.required && !s.feedback.find((f) => f.key === p.key)?.text.trim()) issue(["feedback", p.key], `${p.title}: ${labels.errorRequired}`);
      }
      if (aboutYou) {
        const f = aboutYou.fields;
        if (f.email.enabled && f.email.required && !s.person.email) issue(["person", "email"], `${labels.email}: ${labels.errorField}`);
        for (const k of ["title", "company", "phone"] as const) {
          if (f[k].enabled && f[k].required && !s.person[k]) issue(["person", k], `${labels[k === "title" ? "jobTitle" : k]}: ${labels.errorField}`);
        }
        if (f.website.enabled && f.website.required && !s.authorWebsite) issue(["authorWebsite"], `${labels.website}: ${labels.errorField}`);
      }
      if (company) {
        if (company.fields.company.enabled && company.fields.company.required && !s.person.company) {
          issue(["person", "company"], `${labels.company}: ${labels.errorField}`);
        }
        if (company.fields.website.enabled && company.fields.website.required && !s.authorWebsite) {
          issue(["authorWebsite"], `${labels.companyWebsite}: ${labels.errorField}`);
        }
      }
      if (s.authorWebsite && !isUrl(s.authorWebsite)) issue(["authorWebsite"], labels.errorUrl);
      for (const f of fields) {
        const problem = checkCustom(f, s.customFields[f.key]);
        if (problem) issue(["customFields", f.key], `${f.label}: ${labels[problem]}`);
      }
      if (!s.consent.public && !consent?.allowPrivate) issue(["consent", "public"], labels.errorConsent);
      const answeredAny = questions.some((q) => {
        const a = s.answers.find((x) => x.key === q.key);
        return (q.mode !== "video" && a?.text?.trim()) || (q.mode !== "text" && a?.videoUpload);
      });
      if (!answeredAny) issue(["answers"], labels.errorRequired);
    })
    .transform(keep);
}
export type CheckedSubmission = ReturnType<ReturnType<typeof buildSubmissionSchema>["parse"]>;

/**
 * The answer that becomes the testimonial's own text and video: the main
 * question's, or, when it was optional and skipped, the first question that
 * was answered. The rest are stored as answers (FORM-04).
 */
export function pickPrimary(
  cfg: Pick<FormConfig, "pages">,
  answers: Pick<SubmittedAnswer, "key" | "text" | "videoUpload">[],
): { questionKey: string; question: QuestionPage; text?: string; videoUpload?: string } | null {
  const questions = cfg.pages.filter(isQuestion).filter((q) => q.enabled);
  const has = (q: QuestionPage) => {
    const a = answers.find((x) => x.key === q.key);
    return a && (a.text?.trim() || a.videoUpload) ? a : null;
  };
  const main = questions.find((q) => q.primary);
  const chosen = (main && has(main) && main) || questions.find((q) => has(q));
  if (!chosen) return null;
  const a = has(chosen)!;
  return { questionKey: chosen.key, question: chosen, text: a.text?.trim() || undefined, videoUpload: a.videoUpload || undefined };
}

// ----------------------------------------------------------------- prefill

export type Prefill = {
  person: Partial<Record<PersonKey, string>>;
  /** Prefilled details the person can't change (settings.lockPrefill). */
  locked: PersonKey[];
  /** Link parameters on the form's allow-list, stored privately with the testimonial. */
  hidden: Record<string, string>;
};

/**
 * Reads ?name=&email=&company=&title=&website=&phone= and the form's hidden
 * fields (?utm_source=…) from a link. At most 20 parameters are looked at,
 * each cut to 200 characters. A signed request link (?r=, checked by the
 * caller and passed as `request`) wins over plain parameters for the details
 * it carries.
 */
export function parsePrefill(
  q: Record<string, string | string[] | undefined>,
  cfg: Pick<FormConfig, "settings">,
  request?: { name?: string | null; email?: string | null; company?: string | null; title?: string | null } | null,
): Prefill {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, PREFILL_MAX_CHARS) || undefined;
  const keys = Object.keys(q).slice(0, PREFILL_MAX_KEYS);
  const person: Prefill["person"] = {};
  const hidden: Record<string, string> = {};
  for (const k of keys) {
    const v = one(q[k]);
    if (!v) continue;
    if ((PERSON_KEYS as readonly string[]).includes(k)) person[k as PersonKey] = v;
    if (cfg.settings.hiddenFields.includes(k) && Object.keys(hidden).length < PREFILL_MAX_KEYS) hidden[k] = v;
  }
  if (person.email && !EMAIL_RE.test(person.email)) delete person.email;
  if (person.website && !isUrl(person.website)) delete person.website;
  if (request) {
    for (const k of ["name", "email", "company", "title"] as const) {
      const v = request[k]?.trim();
      if (v) person[k] = v.slice(0, PREFILL_MAX_CHARS);
    }
  }
  const locked = PERSON_KEYS.filter((k) => cfg.settings.lockPrefill.includes(k) && person[k]);
  return { person, locked, hidden };
}

// ------------------------------------------------------------- after send

/** The form's auto-tags plus the tag of each chosen dropdown option (FORM-06, FORM-10). */
export function tagsFromSubmission(cfg: FormConfig, custom: Record<string, unknown>): string[] {
  const tags = [...cfg.settings.autoTags];
  for (const f of customFields(cfg)) {
    if (f.type !== "dropdown") continue;
    const tag = f.options?.find((o) => o.label === custom[f.key])?.tag;
    if (tag) tags.push(tag);
  }
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** What the thank-you page shows; ratings of 3 or less get the low variant when one is set. Empty title or message = the label default. */
export function thankYouFor(cfg: Pick<FormConfig, "pages">, rating?: number) {
  const page = cfg.pages.find((p): p is Extract<FormPage, { type: "thank_you" }> => p.type === "thank_you");
  const low = rating !== undefined && rating > 0 && rating <= 3 ? page?.low : undefined;
  return {
    title: low?.title || page?.title || "",
    message: low?.message || page?.message || "",
    cta: page?.cta,
    copyText: page?.copyText ?? false,
    share: page?.share ?? false,
  };
}
export type ThankYou = ReturnType<typeof thankYouFor>;

/** A label with the project's name (and anything else) filled in. */
export function say(labels: Labels, key: keyof Labels, values: Record<string, string | number> = {}) {
  return fillLabel(labels[key], values);
}
