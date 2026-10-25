import type { Project } from "@/db/schema";
import type { LegacyFormField } from "./legacy";
import type { FormConfig } from "./schema";

/**
 * Translating between a project's legacy form columns and its default form
 * (plan §2.4). Contract published by WP1.1; WP1.2 owns and implements it.
 */

/** A SettingsPanel or AutoApprovePanel PATCH: any of the mirrored project columns. */
export type LegacyFormPatch = Partial<Pick<Project, LegacyFormField>>;

/**
 * The classic form today's project columns describe: rating (optional), the
 * prompt as question q1 with the project's tips and modes, consent, about you,
 * thank you; design.primary = accentColor; the auto-approve rule and the
 * confirmation email from the project.
 */
export function formConfigFromProject(p: Project): FormConfig {
  throw new Error("not implemented: formConfigFromProject");
}

/**
 * The reverse, for the default form only. Rules the columns can't hold are
 * clamped (D3: minRating to 4 or 5); autoApproveSince is carried exactly.
 */
export function projectColumnsFromForm(cfg: FormConfig): Partial<Project> {
  throw new Error("not implemented: projectColumnsFromForm");
}

/** Applies a legacy project PATCH to the default form's config. */
export function legacyPatchToFormPatch(patch: LegacyFormPatch, cfg: FormConfig): FormConfig {
  throw new Error("not implemented: legacyPatchToFormPatch");
}

/**
 * Whether classic CollectForm can still render this config: false once it
 * uses a second question, custom fields, a locale other than English or design
 * beyond the accent colour (the builder then asks to switch to step-by-step).
 */
export function classicCompatible(cfg: FormConfig): boolean {
  throw new Error("not implemented: classicCompatible");
}
