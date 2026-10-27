import type { Project } from "@/db/schema";
import { DEFAULT_PROMPT, DEFAULT_THANK_YOU, resolveQuestions, type LegacyFormField } from "./legacy";
import {
  formDesignSchema,
  formLabelsSchema,
  formPagesSchema,
  formSettingsSchema,
  type AutoApproveRule,
  type FormConfig,
  type QuestionPage,
  type ResponseMode,
} from "./schema";

/**
 * Translating between a project's legacy form columns and its default form
 * (plan §2.4). Client-safe like schema.ts, so the builder can call
 * classicCompatible as the owner edits.
 */

/** A SettingsPanel or AutoApprovePanel PATCH: any of the mirrored project columns. */
export type LegacyFormPatch = Partial<Pick<Project, LegacyFormField>>;

const HEX = /^#[0-9a-fA-F]{6}$/;
// The schema's limits (src/lib/forms/schema.ts); the project columns allow a little more in places.
const TITLE_MAX = 300;
const TIP_MAX = 200;
const MAX_TIPS = 8;
const CONSENT_MAX = 1000;
const MESSAGE_MAX = 2000;

const clip = (s: string, max: number) => s.trim().slice(0, max).trim();
const clampInt = (n: number, min: number, max: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
const clampSeconds = (n: number) => clampInt(n, 15, 600, 120);
const clampRating = (n: number) => clampInt(n, 1, 5, 4) as AutoApproveRule["minRating"];

/** The project's tips as a question's: the defaults for none, within the schema's 8 × 200 characters. */
const tipsFrom = (questions: string) =>
  resolveQuestions({ questions })
    .slice(0, MAX_TIPS)
    .map((t) => clip(t, TIP_MAX));

/** The questions CollectForm asks about the person, as about-you fields: name (always), then email, photo, title and company, all optional. */
const CLASSIC_ABOUT_YOU = {
  email: { enabled: true, required: false },
  photo: { enabled: true, required: false },
  title: { enabled: true, required: false },
  company: { enabled: true, required: false },
  website: { enabled: false, required: false },
  phone: { enabled: false, required: false },
  socials: { enabled: false, required: false },
};

/** The answer mode two project columns describe. Neither (a page that takes nothing) isn't a mode, so it reads as both. */
export function modeFromFlags(allowVideo: boolean, allowText: boolean): ResponseMode {
  if (allowVideo && !allowText) return "video";
  if (allowText && !allowVideo) return "text";
  return "video_text";
}

export function flagsFromMode(mode: ResponseMode): { allowVideo: boolean; allowText: boolean } {
  return { allowVideo: mode !== "text", allowText: mode !== "video" };
}

/** The main question: its answer is stored on the testimonial itself. */
export function primaryQuestion(cfg: Pick<FormConfig, "pages">): QuestionPage | undefined {
  return cfg.pages.find((p): p is QuestionPage => p.type === "question" && p.primary);
}

/** Deep equality for config values: dates by time, and an absent key the same as null. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].every((k) => sameValue(x[k], y[k]));
  }
  return a === b || (a == null && b == null);
}

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Partial<Pick<T, K>> {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as Partial<Pick<T, K>>;
}

/**
 * The classic form today's project columns describe: rating (optional), the
 * prompt as question q1 with the project's tips and modes, consent, about you,
 * thank you; design.primary = accentColor; the auto-approve rule and the
 * confirmation email from the project.
 *
 * Empty consent wording stays empty (it means the default wording, as on the
 * project), so the mirror hands SettingsPanel back exactly what it saved.
 */
export function formConfigFromProject(p: Project): FormConfig {
  return {
    v: 1,
    layout: "classic",
    pages: formPagesSchema.parse([
      { type: "rating", enabled: true, required: false },
      { type: "welcome", enabled: false },
      {
        type: "question",
        key: "q1",
        enabled: true,
        primary: true,
        required: true,
        title: clip(p.prompt, TITLE_MAX) || DEFAULT_PROMPT,
        tips: tipsFrom(p.questions),
        mode: modeFromFlags(p.allowVideo, p.allowText),
        maxVideoSeconds: clampSeconds(p.maxVideoSeconds),
      },
      { type: "consent", text: clip(p.consentText, CONSENT_MAX), scopes: ["social"], allowPrivate: false },
      { type: "about_you", fields: CLASSIC_ABOUT_YOU, custom: [] },
      { type: "review", enabled: false },
      { type: "thank_you", message: clip(p.thankYouMessage, MESSAGE_MAX) },
    ]),
    design: formDesignSchema.parse(HEX.test(p.accentColor) ? { primary: p.accentColor } : {}),
    labels: formLabelsSchema.parse({}),
    settings: formSettingsSchema.parse({
      autoApprove: {
        mode: p.autoApprove ? "rating" : "off",
        minRating: clampRating(p.autoApproveMinRating),
        includeVideo: p.autoApproveVideo,
        since: p.autoApproveSince ?? null,
      },
      confirmationEmail: { enabled: p.thankYouEmail },
    }),
  };
}

/**
 * A new form that isn't the default: the project's question, tips, consent and
 * thank-you wording, step by step, with every rule off and colours left to the
 * brand kit (D1: new forms start as steps).
 */
export function newFormConfig(p: Project): FormConfig {
  return { ...formConfigFromProject(p), layout: "steps", design: formDesignSchema.parse({}), settings: formSettingsSchema.parse({}) };
}

/**
 * The reverse, for the default form only. Rules the columns can't hold are
 * clamped (D3: minRating to 4 or 5); autoApproveSince is carried exactly. An
 * empty thank-you message means the default wording, which the column spells
 * out (the classic submit route answers with it).
 */
export function projectColumnsFromForm(cfg: FormConfig): Partial<Project> {
  const q = primaryQuestion(cfg);
  const consent = cfg.pages.find((p) => p.type === "consent");
  const thanks = cfg.pages.find((p) => p.type === "thank_you");
  const rule = cfg.settings.autoApprove;
  return {
    ...(q ? { prompt: q.title, questions: q.tips.join("\n"), ...flagsFromMode(q.mode), maxVideoSeconds: q.maxVideoSeconds } : {}),
    ...(consent ? { consentText: consent.text } : {}),
    ...(thanks ? { thankYouMessage: thanks.message || DEFAULT_THANK_YOU } : {}),
    ...(cfg.design.primary ? { accentColor: cfg.design.primary } : {}),
    thankYouEmail: cfg.settings.confirmationEmail.enabled,
    // D3: "all", "text", "public" and minimums below 4 show as on, at 4 or 5; the decision itself always comes from the form.
    autoApprove: rule.mode !== "off",
    autoApproveMinRating: Math.max(4, rule.minRating),
    autoApproveVideo: rule.includeVideo,
    autoApproveSince: rule.since,
  };
}

/** Columns read together: the answer mode lives in two. */
const MIRROR_GROUPS: readonly (readonly LegacyFormField[])[] = [
  ["prompt"],
  ["questions"],
  ["allowVideo", "allowText"],
  ["maxVideoSeconds"],
  ["consentText"],
  ["thankYouMessage"],
  ["thankYouEmail"],
  ["accentColor"],
  ["autoApprove"],
  ["autoApproveMinRating"],
  ["autoApproveVideo"],
  ["autoApproveSince"],
];

/**
 * The project columns to write so they mirror `cfg`, the default form's
 * config (D2). A stored value is kept when it already describes the same form:
 * empty questions (meaning the default prompts) stay empty, both answer types
 * switched off stay off, and so on, so pages that read the columns see no
 * change the owner didn't make.
 */
export function mirrorColumns(project: Project, cfg: FormConfig): Partial<Project> {
  const target = projectColumnsFromForm(cfg);
  const read = (p: Project) => projectColumnsFromForm(formConfigFromProject(p));
  const wanted = read({ ...project, ...target });
  const out: Partial<Project> = {};
  for (const group of MIRROR_GROUPS) {
    if (!group.some((k) => k in target)) continue;
    const kept = read({ ...project, ...target, ...pick(project, group) });
    if (!sameValue(pick(kept, group), pick(wanted, group))) Object.assign(out, pick(target, group));
  }
  return out;
}

/**
 * When a rule applies from: turning it on starts it now (never what's already
 * waiting), turning it off clears it, and a rule that stays on keeps its date.
 */
export function nextAutoApproveSince(before: AutoApproveRule, after: AutoApproveRule, now = new Date()): Date | null {
  if (after.mode === "off") return null;
  return before.mode === "off" ? now : before.since;
}

/**
 * Applies a legacy project PATCH to the default form's config. SettingsPanel
 * sends every field on each save, so a value that still reads the same leaves
 * the form alone: the 4-or-5 rating the panel shows doesn't overwrite a lower
 * minimum set in the builder, and "on" keeps a custom mode (D3).
 */
export function legacyPatchToFormPatch(patch: LegacyFormPatch, cfg: FormConfig, now = new Date()): FormConfig {
  const next = structuredClone(cfg);
  const q = primaryQuestion(next);
  const consent = next.pages.find((p) => p.type === "consent");
  const thanks = next.pages.find((p) => p.type === "thank_you");
  const rule = next.settings.autoApprove;

  if (q) {
    if (patch.prompt !== undefined && clip(patch.prompt, TITLE_MAX)) q.title = clip(patch.prompt, TITLE_MAX);
    if (patch.questions !== undefined && !sameValue(tipsFrom(patch.questions), q.tips)) q.tips = tipsFrom(patch.questions);
    if (patch.allowVideo !== undefined || patch.allowText !== undefined) {
      const flags = flagsFromMode(q.mode);
      q.mode = modeFromFlags(patch.allowVideo ?? flags.allowVideo, patch.allowText ?? flags.allowText);
    }
    if (patch.maxVideoSeconds !== undefined) q.maxVideoSeconds = clampSeconds(patch.maxVideoSeconds);
  }
  if (consent && patch.consentText !== undefined) consent.text = clip(patch.consentText, CONSENT_MAX);
  if (thanks && patch.thankYouMessage !== undefined && clip(patch.thankYouMessage, MESSAGE_MAX)) {
    thanks.message = clip(patch.thankYouMessage, MESSAGE_MAX);
  }
  if (patch.accentColor !== undefined && HEX.test(patch.accentColor)) next.design.primary = patch.accentColor;
  if (patch.thankYouEmail !== undefined) next.settings.confirmationEmail.enabled = patch.thankYouEmail;

  if (patch.autoApprove === false) {
    rule.mode = "off";
    rule.since = null;
  } else if (patch.autoApprove) {
    // As updateProject did: on from now, or from when it was first turned on.
    if (rule.mode === "off") {
      rule.mode = "rating";
      rule.since = now;
    } else rule.since ??= now;
  }
  // Turning the rule on from off applies the rating shown: an "off" rule's lower minimum was never on screen.
  const turnedOn = patch.autoApprove === true && cfg.settings.autoApprove.mode === "off";
  if (
    patch.autoApproveMinRating !== undefined &&
    (turnedOn || patch.autoApproveMinRating !== Math.max(4, cfg.settings.autoApprove.minRating))
  ) {
    rule.minRating = clampRating(patch.autoApproveMinRating);
  }
  if (patch.autoApproveVideo !== undefined) rule.includeVideo = patch.autoApproveVideo;
  if (patch.autoApproveSince !== undefined) rule.since = patch.autoApproveSince;
  return next;
}

/**
 * Whether classic CollectForm can still render this config: false once it
 * uses a second question, custom fields, a locale other than English or design
 * beyond the accent colour (the builder then asks to switch to step-by-step).
 * Pass the form's language; the config doesn't hold it. Every settings-tab
 * rule (auto-approve, auto-tags, pausing, limits, emails, notifications) works
 * on classic forms too, so rules never make a form incompatible; only what
 * the page itself would have to show does.
 */
export function classicCompatible(cfg: FormConfig, language = "en"): boolean {
  if (language !== "en" || Object.keys(cfg.labels.overrides).length) return false;
  if (!sameValue(cfg.design, formDesignSchema.parse({ primary: cfg.design.primary }))) return false;
  const { hiddenFields, lockPrefill, landscapePrompt, lowRating } = cfg.settings;
  if (hiddenFields.length || lockPrefill.length || landscapePrompt) return false;
  // FORM-12 swaps steps, which the one-page classic form doesn't have.
  if (lowRating.enabled) return false;
  // CollectForm always shows the (optional) rating.
  if (!cfg.pages.some((p) => p.type === "rating" && p.enabled)) return false;
  return cfg.pages.every((p) => {
    switch (p.type) {
      case "rating":
        return !p.enabled || (!p.required && !p.title && !p.subtitle);
      case "question":
        return !p.enabled || (p.primary && p.required && !p.subtitle && !p.videoSubtitle && !p.allowImages);
      case "welcome":
      case "feedback":
      case "about_company":
      case "review":
        return !p.enabled;
      case "consent":
        return !p.allowPrivate && sameValue([...p.scopes].sort(), ["social"]);
      case "about_you":
        return (
          !p.custom.length &&
          Object.entries(CLASSIC_ABOUT_YOU).every(([k, want]) => {
            const field = p.fields[k as keyof typeof CLASSIC_ABOUT_YOU];
            return field.enabled === want.enabled && (!field.enabled || !field.required);
          })
        );
      case "thank_you":
        return !p.title && !p.cta && !p.copyText && !p.share && !p.low;
    }
  });
}
