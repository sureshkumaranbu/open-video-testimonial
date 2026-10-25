import type { Project } from "@/db/schema";

/**
 * The per-project form settings from before forms existed. They're kept as a
 * write-through mirror of the default form (D2), so code that reads them
 * (SettingsPanel, AutoApprovePanel, projectToApi, classic CollectForm) keeps
 * working. No import from testimonials.ts here: it imports this file.
 *
 * Contract published by WP1.1; WP1.2 owns it (and WP1.3 makes
 * testimonials.ts re-export DEFAULT_QUESTIONS from here).
 */

export const DEFAULT_QUESTIONS = [
  "What were things like before?",
  "What changed for you?",
  "Who would you recommend it to?",
];

/** The question a project starts with (same as testimonials.ts, which can re-export it like DEFAULT_QUESTIONS). */
export const DEFAULT_PROMPT = "How has our product helped you? We'd love to hear your story.";

/** What the form says after a submission when no message is set (testimonials.ts re-exports it). */
export const DEFAULT_THANK_YOU = "Thank you! Your testimonial has been received.";

/** The project columns that mirror the default form; a patch touching any of them goes through the form. */
export const LEGACY_FORM_FIELDS = [
  "prompt",
  "questions",
  "allowVideo",
  "allowText",
  "maxVideoSeconds",
  "consentText",
  "thankYouMessage",
  "thankYouEmail",
  "accentColor",
  "autoApprove",
  "autoApproveMinRating",
  "autoApproveVideo",
  "autoApproveSince",
] as const satisfies readonly (keyof Project)[];
export type LegacyFormField = (typeof LEGACY_FORM_FIELDS)[number];

/** The project's prompts, one per line, falling back to the defaults (today's projectQuestions). */
export function resolveQuestions(p: Pick<Project, "questions">): string[] {
  const lines = p.questions
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines : DEFAULT_QUESTIONS;
}
