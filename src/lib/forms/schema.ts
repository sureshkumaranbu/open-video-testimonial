import { z } from "zod";
import type { Form, FormLayout, FormStatus } from "@/db/schema";

/**
 * The shape of a form's config, stored as JSON in the forms row (pages,
 * design, labels, settings). Client-safe: no Node APIs, and only types come
 * from the database schema, so the builder and the runner can use it too.
 *
 * Contract published by WP1.1; WP1.2 owns and fills in parseFormRow and
 * toPublicForm (WP2.2 extends the page types later).
 */

export const PAGE_TYPES = ["rating", "welcome", "question", "feedback", "consent", "about_you", "about_company", "review", "thank_you"] as const;
export type PageType = (typeof PAGE_TYPES)[number];
/** How a question may be answered. */
export const RESPONSE_MODES = ["video_text", "video", "text"] as const;
export type ResponseMode = (typeof RESPONSE_MODES)[number];
export const FIELD_TYPES = ["short", "long", "dropdown", "checkbox", "nps", "url", "number"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** What a person can agree to. "website" is what the required box grants; the rest are offered per form (D12). */
export const FORM_CONSENT_SCOPES = ["website", "social", "ads", "name", "face"] as const;
export const AUTO_APPROVE_MODES = ["off", "all", "rating", "text", "public"] as const;
export type AutoApproveMode = (typeof AUTO_APPROVE_MODES)[number];

/** Names an answer or field in exports (custom:<key>) and links (?<key>=). */
export const fieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers and underscores, starting with a letter");

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const copy = (max: number) => z.string().max(max);

export const customFieldSchema = z.object({
  key: fieldKeySchema,
  type: z.enum(FIELD_TYPES),
  label: z.string().trim().min(1).max(200),
  placeholder: copy(200).optional(),
  required: z.boolean().default(false),
  /** Dropdown choices. A choice with a tag adds that tag to the testimonial. */
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(100), tag: z.string().trim().min(1).max(32).optional() }))
    .max(50)
    .optional(),
});
export type CustomField = z.infer<typeof customFieldSchema>;

/** One standard detail on an about page: whether it's asked for, and whether it must be given. */
const detail = (enabled: boolean) => z.object({ enabled: z.boolean(), required: z.boolean().default(false) }).prefault({ enabled });

const ratingPage = z.object({
  type: z.literal("rating"),
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
  title: copy(300).default(""),
});

const welcomePage = z.object({
  type: z.literal("welcome"),
  enabled: z.boolean().default(false),
  title: copy(300).default(""),
  message: copy(2000).default(""),
});

const questionPage = z.object({
  type: z.literal("question"),
  key: fieldKeySchema,
  enabled: z.boolean().default(true),
  /** The answer stored on the testimonial itself (text / video); exactly one per form. */
  primary: z.boolean().default(false),
  required: z.boolean().default(true),
  title: z.string().trim().min(1).max(300),
  subtitle: copy(500).optional(),
  videoSubtitle: copy(500).optional(),
  /** Prompts shown beside the answer and over the camera. */
  tips: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  mode: z.enum(RESPONSE_MODES).default("video_text"),
  maxVideoSeconds: z.number().int().min(15).max(600).default(120),
  allowImages: z.number().int().min(0).max(3).default(0),
});

/** A private question: its answer goes to the feedback list, never onto the testimonial. */
const feedbackPage = z.object({
  type: z.literal("feedback"),
  key: fieldKeySchema,
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
  title: z.string().trim().min(1).max(300),
  subtitle: copy(500).optional(),
});

const consentPage = z.object({
  type: z.literal("consent"),
  /** Empty means the default wording. `{project}` is replaced. */
  text: copy(1000).default(""),
  /** Optional extras offered beside the required box. */
  scopes: z.array(z.enum(FORM_CONSENT_SCOPES)).max(FORM_CONSENT_SCOPES.length).default(["social"]),
  /** Offer "keep it private" (stored as testimonials.consent_public = false, D11). */
  allowPrivate: z.boolean().default(false),
});

const aboutYouPage = z.object({
  type: z.literal("about_you"),
  /** The name is always asked for and required. */
  fields: z
    .object({
      email: detail(true),
      photo: detail(true),
      title: detail(true),
      company: detail(true),
      website: detail(false),
      phone: detail(false),
      socials: detail(false),
    })
    .prefault({}),
  custom: z.array(customFieldSchema).max(20).default([]),
});

const aboutCompanyPage = z.object({
  type: z.literal("about_company"),
  enabled: z.boolean().default(false),
  fields: z.object({ company: detail(true), website: detail(true), logo: detail(true) }).prefault({}),
  custom: z.array(customFieldSchema).max(20).default([]),
});

const reviewPage = z.object({
  type: z.literal("review"),
  enabled: z.boolean().default(false),
});

const thankYouPage = z.object({
  type: z.literal("thank_you"),
  title: copy(300).default(""),
  message: copy(2000).default(""),
  cta: z.object({ label: z.string().trim().min(1).max(80), url: z.url().max(2000) }).optional(),
  /** Offer to copy their words (to post elsewhere). */
  copyText: z.boolean().default(false),
  /** Share links; shown only when they agreed to social use. */
  share: z.boolean().default(false),
});

export const formPageSchema = z.discriminatedUnion("type", [
  ratingPage,
  welcomePage,
  questionPage,
  feedbackPage,
  consentPage,
  aboutYouPage,
  aboutCompanyPage,
  reviewPage,
  thankYouPage,
]);
export type FormPage = z.infer<typeof formPageSchema>;
export type QuestionPage = Extract<FormPage, { type: "question" }>;

export const MAX_QUESTIONS = 10;

/** Exactly one primary question (always on), at most 10 questions, unique keys, one consent and one thank-you page. */
export const formPagesSchema = z
  .array(formPageSchema)
  .max(30)
  .superRefine((pages, ctx) => {
    const questions = pages.filter((p): p is QuestionPage => p.type === "question");
    const primary = questions.filter((q) => q.primary);
    if (primary.length !== 1) ctx.addIssue({ code: "custom", message: "A form needs exactly one main question" });
    else if (!primary[0].enabled) ctx.addIssue({ code: "custom", message: "The main question can't be turned off" });
    if (questions.length > MAX_QUESTIONS) ctx.addIssue({ code: "custom", message: `A form can have at most ${MAX_QUESTIONS} questions` });
    const keys = pages.flatMap((p) => [
      ...(p.type === "question" || p.type === "feedback" ? [p.key] : []),
      ...(p.type === "about_you" || p.type === "about_company" ? p.custom.map((f) => f.key) : []),
    ]);
    const dupe = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dupe) ctx.addIssue({ code: "custom", message: `Two questions or fields share the key "${dupe}"` });
    for (const type of ["consent", "thank_you"] as const) {
      if (pages.filter((p) => p.type === type).length !== 1) {
        ctx.addIssue({ code: "custom", message: `A form needs exactly one ${type === "consent" ? "consent" : "thank-you"} page` });
      }
    }
  });

export const formDesignSchema = z.object({
  showLogo: z.boolean().default(true),
  /** Colours left out follow the brand kit (then the project's accent colour). */
  primary: hex.optional(),
  background: hex.optional(),
  text: hex.optional(),
  button: hex.optional(),
  buttonText: hex.optional(),
  star: hex.optional(),
  /** FONT_CHOICES ids (WP2.2). */
  headingFont: copy(40).optional(),
  bodyFont: copy(40).optional(),
  width: z.enum(["wide", "compact"]).default("wide"),
  buttonStyle: z.enum(["solid", "soft"]).default("solid"),
  radius: z.number().int().min(0).max(24).default(12),
  theme: z.enum(["light", "dark"]).default("light"),
});
export type FormDesign = z.infer<typeof formDesignSchema>;

/** Owner overrides of the locale's wording only; keys are LabelKey (WP2.2, src/lib/forms/labels.ts). */
export const formLabelsSchema = z.object({
  overrides: z.record(z.string(), z.string().max(500)).default({}),
});
export type FormLabels = z.infer<typeof formLabelsSchema>;

export const autoApproveRuleSchema = z.object({
  mode: z.enum(AUTO_APPROVE_MODES).default("off"),
  minRating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).default(4),
  includeVideo: z.boolean().default(false),
  /** When the rule was last turned on; testimonials sent before then are left alone. */
  since: z.union([z.null(), z.coerce.date()]).default(null),
});
export type AutoApproveRule = z.infer<typeof autoApproveRuleSchema>;

export const formSettingsSchema = z.object({
  autoApprove: autoApproveRuleSchema.prefault({}),
  /** Tags every submission gets. */
  autoTags: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
  /** The thank-you email to the author (sent for request-link submissions only). Empty subject/body = the default. */
  confirmationEmail: z
    .object({ enabled: z.boolean().default(true), subject: copy(200).default(""), body: copy(5000).default("") })
    .prefault({}),
  /** Which notification channels hear about this form's submissions. */
  notify: z.object({ channelIds: z.union([z.literal("all"), z.array(z.string()).max(50)]).default("all") }).prefault({}),
  /** Suggest turning the phone sideways before recording. */
  landscapePrompt: z.boolean().default(false),
  /** Shown instead of the form while it's paused. */
  closedMessage: copy(1000).default(""),
  maxPerIpPerDay: z.number().int().min(1).max(1000).nullable().default(null),
  /** Link parameters kept as hidden fields (an allow-list). */
  hiddenFields: z.array(fieldKeySchema).max(20).default([]),
  /** Prefilled fields the person can't change. */
  lockPrefill: z.array(z.string().max(40)).max(20).default([]),
  noindex: z.boolean().default(false),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export type FormConfig = {
  v: 1;
  layout: FormLayout;
  pages: FormPage[];
  design: FormDesign;
  labels: FormLabels;
  settings: FormSettings;
};

/** What updateForm accepts; layout, slug and status have their own calls. */
export type FormPatch = Partial<Pick<FormConfig, "pages" | "design" | "labels" | "settings">> & {
  name?: string;
  language?: string;
  logoKey?: string | null;
};

/** The form as public pages and embeds get it: every setting is stripped except what the runner shows. */
export type PublicForm = {
  id: string;
  slug: string;
  name: string;
  status: FormStatus;
  layout: FormLayout;
  language: string;
  logoUrl: string | null;
  pages: FormPage[];
  design: FormDesign;
  labels: FormLabels;
  settings: Pick<FormSettings, "closedMessage" | "landscapePrompt">;
};

/** The row's JSON columns as a FormConfig. Never throws: invalid JSON falls back to defaults and is logged. */
export function parseFormRow(row: Form): FormConfig {
  throw new Error("not implemented: parseFormRow");
}

export function toPublicForm(row: Form, cfg: FormConfig): PublicForm {
  throw new Error("not implemented: toPublicForm");
}
