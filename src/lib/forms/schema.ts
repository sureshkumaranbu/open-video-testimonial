import { z } from "zod";
import type { Form, FormKind, FormLayout, FormStatus } from "@/db/schema";

/**
 * The shape of a form's config, stored as JSON in the forms row (pages,
 * design, labels, settings). Client-safe: no Node APIs, and only types come
 * from the database schema, so the builder and the runner can use it too.
 *
 * Contract published by WP1.1; WP1.2 owns and fills in parseFormRow and
 * toPublicForm (WP2.2 extends the page types later).
 */

// In the browser zod would probe `new Function` for its fast path, which the
// pages' Content Security Policy reports as a violation: run without it there.
if (typeof window !== "undefined") z.config({ jitless: true });

export const PAGE_TYPES = ["rating", "welcome", "question", "feedback", "consent", "about_you", "about_company", "review", "thank_you", "nps"] as const;
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
  subtitle: copy(500).optional(),
});

const welcomePage = z.object({
  type: z.literal("welcome"),
  enabled: z.boolean().default(false),
  title: copy(300).default(""),
  message: copy(2000).default(""),
  /** Short points under the message ("Takes two minutes"…). */
  bullets: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
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
  placeholder: copy(200).optional(),
});

/**
 * NPS-01: "How likely are you to recommend us?" 0–10, then an optional
 * "why". The answer is private (survey_responses, the NPS dashboard). In a
 * survey form, a promoter (9–10) may be offered the testimonial step.
 */
const npsPage = z.object({
  type: z.literal("nps"),
  key: fieldKeySchema,
  enabled: z.boolean().default(true),
  required: z.boolean().default(true),
  title: z.string().trim().min(1).max(300),
  subtitle: copy(500).optional(),
  /** The follow-up; empty = the language's default ("What's the main reason for your score?"). */
  whyTitle: copy(300).default(""),
  whyPlaceholder: copy(200).optional(),
  /** Survey forms only: offer promoters (9–10) the testimonial step after this. */
  offerTestimonial: z.boolean().default(true),
  /** The offer's wording; empty = the language's default. */
  offerTitle: copy(300).default(""),
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
  title: copy(300).default(""),
});

const thankYouPage = z.object({
  type: z.literal("thank_you"),
  title: copy(300).default(""),
  message: copy(2000).default(""),
  cta: z.object({ label: z.string().trim().min(1).max(80), url: z.url({ protocol: /^https?$/ }).max(2000) }).optional(),
  /** Offer to copy their words (to post elsewhere). */
  copyText: z.boolean().default(false),
  /** Share links; shown only when they agreed to social use. */
  share: z.boolean().default(false),
  /** What people who gave 3 stars or fewer see instead (empty = the same as everyone). */
  low: z.object({ title: copy(300).default(""), message: copy(2000).default("") }).optional(),
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
  npsPage,
]);
export type FormPage = z.infer<typeof formPageSchema>;
export type QuestionPage = Extract<FormPage, { type: "question" }>;
export type NpsPage = Extract<FormPage, { type: "nps" }>;

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
    if (pages.filter((p) => p.type === "nps").length > 1) ctx.addIssue({ code: "custom", message: "A form can have one NPS question" });
    const keys = pages.flatMap((p) => [
      ...(p.type === "question" || p.type === "feedback" || p.type === "nps" ? [p.key] : []),
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

export const lowRatingSchema = z.object({
  enabled: z.boolean().default(false),
  /** 1 to 4 stars: 5 would send everyone to private feedback. */
  threshold: z.number().int().min(1).max(4).default(2),
  /** Empty = the language's default wording. */
  title: copy(300).default(""),
  subtitle: copy(500).default(""),
  placeholder: copy(200).default(""),
  /** Offer name and email fields (both optional) so the owner can reply. */
  askContact: z.boolean().default(true),
});
export type LowRatingSettings = z.infer<typeof lowRatingSchema>;

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
  /**
   * FORM-12 (off by default): a rating at or below `threshold` shows a private
   * feedback page instead of the questions, and is stored as feedback, never
   * as a testimonial. Only for private testimonials: review sites forbid
   * gating, and booster pages never do it (BOOST-03).
   */
  lowRating: lowRatingSchema.prefault({}),
  /** INBOX-13: languages new testimonials are machine-translated into on arrival (needs TRANSLATE_PROVIDER). */
  autoTranslate: z
    .array(z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/, "Use language codes such as fr or pt-br"))
    .max(10)
    .default([]),
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
  /** FORM-13: the forms.reward column, checked by rewardConfigSchema (src/lib/rewards-config.ts). */
  reward?: unknown;
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
  /** NPS-01: a survey makes a testimonial only when a promoter opts in. Left out = "testimonial". */
  kind?: FormKind;
  language: string;
  logoUrl: string | null;
  pages: FormPage[];
  design: FormDesign;
  labels: FormLabels;
  /** lowRating is there only while the owner has it on (FORM-12). */
  settings: Pick<FormSettings, "closedMessage" | "landscapePrompt"> & Partial<Pick<FormSettings, "lowRating">>;
};

/**
 * The pages a form falls back to when its own can't be read: a rating, one
 * main question, consent, about you and thank you. New forms start from the
 * project instead (src/lib/forms/defaults.ts).
 */
export function defaultPages(): FormPage[] {
  return formPagesSchema.parse([
    { type: "rating" },
    { type: "welcome" },
    { type: "question", key: "q1", primary: true, title: "Tell us about your experience" },
    { type: "consent" },
    { type: "about_you" },
    { type: "review" },
    { type: "thank_you" },
  ]);
}

function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * One JSON object column. When it doesn't parse, the keys that are still valid
 * are kept and the rest get their defaults, so one bad value never resets the
 * whole column (an auto-approve rule, say, when only a colour is wrong).
 */
function parseObject<S extends z.ZodObject>(schema: S, raw: string, report: (what: string) => void, what: string): z.output<S> {
  const value = readJson(raw);
  const full = schema.safeParse(value);
  if (full.success) return full.data;
  report(what);
  const input = isRecord(value) ? value : {};
  const valid = Object.fromEntries(
    Object.entries(schema.shape).flatMap(([key, field]) =>
      key in input && (field as z.ZodType).safeParse(input[key]).success ? [[key, input[key]]] : [],
    ),
  );
  return schema.parse(valid);
}

/** The pages column: pages that no longer parse are dropped, and if what's left isn't a whole form, defaultPages(). */
function parsePages(raw: string, report: (what: string) => void): FormPage[] {
  const value = readJson(raw);
  const full = formPagesSchema.safeParse(value);
  if (full.success) return full.data;
  report("pages");
  const pages = (Array.isArray(value) ? value : []).flatMap((p) => {
    const page = formPageSchema.safeParse(p);
    return page.success ? [page.data] : [];
  });
  const kept = formPagesSchema.safeParse(pages);
  return kept.success ? kept.data : defaultPages();
}

/**
 * The row's JSON columns as a FormConfig. Never throws: invalid JSON falls back
 * to defaults and is logged. A row still at config_version 0 (made by migration
 * 0009) has no config of its own yet, so read forms through getForm or
 * getDefaultForm (src/lib/forms/index.ts), which fill it in from the project.
 */
export function parseFormRow(row: Form): FormConfig {
  // Unhydrated rows are expected to be empty; anything else is worth a line in the log.
  const report = (what: string) => {
    if (row.configVersion !== 0) console.warn(`[forms] form ${row.id}: ${what} could not be read; using defaults`);
  };
  return {
    v: 1,
    layout: row.layout,
    pages: parsePages(row.pages, report),
    design: parseObject(formDesignSchema, row.design, report, "design"),
    labels: parseObject(formLabelsSchema, row.labels, report, "labels"),
    settings: parseObject(formSettingsSchema, row.settings, report, "settings"),
  };
}

/** Dropdown choices without their tags: which tag a choice adds is the owner's business. */
function publicFields(fields: CustomField[]): CustomField[] {
  return fields.map((f) => (f.options ? { ...f, options: f.options.map(({ label }) => ({ label })) } : f));
}

/** What public pages and embeds get: the pages, design and wording, but no rules (auto-approve, limits, emails, notifications). */
export function toPublicForm(row: Form, cfg: FormConfig): PublicForm {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    layout: cfg.layout,
    kind: row.kind ?? "testimonial",
    language: row.language,
    // Same URL as mediaUrl() in storage.ts, which this client-safe file can't import.
    logoUrl: row.logoKey ? `/api/media/${row.logoKey}` : null,
    pages: cfg.pages.map((p) => (p.type === "about_you" || p.type === "about_company" ? { ...p, custom: publicFields(p.custom) } : p)),
    design: cfg.design,
    labels: cfg.labels,
    settings: {
      closedMessage: cfg.settings.closedMessage,
      landscapePrompt: cfg.settings.landscapePrompt,
      ...(cfg.settings.lowRating.enabled ? { lowRating: cfg.settings.lowRating } : {}),
    },
  };
}
