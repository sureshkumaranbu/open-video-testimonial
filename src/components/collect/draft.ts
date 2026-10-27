import { PERSON_KEYS, SOCIAL_KEYS, type Answers } from "@/lib/forms/engine";
import type { FormPage } from "@/lib/forms/schema";

/**
 * Draft autosave for the step-by-step form (FORM-14): the text answers,
 * rating, feedback, custom and about-you values and the current step, in
 * this browser's localStorage for 7 days, one draft per form. Nothing here
 * ever goes to the server; the draft is only read back into the form.
 * Files (videos, photos, images) and consent are never kept: a video is
 * recorded again, and consent is given again. Every storage call is
 * guarded, so private mode or blocked storage just means no draft.
 */

export const DRAFT_DAYS = 7;
const DRAFT_MS = DRAFT_DAYS * 24 * 60 * 60 * 1000;
const VERSION = 1;

export type FormDraft = {
  v: typeof VERSION;
  savedAt: number;
  /** The step's page key or type, so a reordered form still lands on the right page. */
  step: { index: number; id: string };
  rating: number;
  answers: Record<string, { mode: "text" | "video"; text: string }>;
  feedback: Record<string, string>;
  person: Answers["person"];
  custom: Record<string, string | boolean>;
  /** A video was recorded before; it isn't in the draft, so it's recorded again. */
  hadVideo: boolean;
};

export const draftKey = (formId: string) => `plaudit:draft:${formId}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** How a page is found again: its key, else its type (there is one page of each other type). */
export function pageId(p: FormPage): string {
  return "key" in p && typeof p.key === "string" ? `q:${p.key}` : p.type;
}

/** Whether the person has written or picked anything (prefilled details don't count). */
export function hasContent(state: Answers, prefilled: Partial<Record<string, string>> = {}): boolean {
  if (state.rating > 0) return true;
  if (Object.values(state.answers).some((a) => a.text.trim() || a.hasVideo)) return true;
  if (Object.values(state.feedback).some((t) => t.trim())) return true;
  if (Object.values(state.custom).some((v) => v !== "" && v !== false)) return true;
  if (PERSON_KEYS.some((k) => state.person[k].trim() && state.person[k] !== (prefilled[k] ?? ""))) return true;
  return Object.values(state.person.socials).some((v) => v?.trim());
}

/** The draft for this moment of the form. */
export function toDraft(state: Answers, steps: FormPage[], step: number, now = Date.now()): FormDraft {
  const page = steps[step];
  return {
    v: VERSION,
    savedAt: now,
    step: { index: step, id: page ? pageId(page) : "" },
    rating: state.rating,
    answers: Object.fromEntries(Object.entries(state.answers).map(([k, a]) => [k, { mode: a.mode, text: a.text }])),
    feedback: state.feedback,
    person: state.person,
    custom: state.custom,
    hadVideo: Object.values(state.answers).some((a) => a.hasVideo),
  };
}

const isString = (v: unknown): v is string => typeof v === "string";
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Reads a draft back, or null when there is none, it's broken, or it's more than 7 days old (then it's removed). */
export function loadDraft(formId: string, now = Date.now()): FormDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(draftKey(formId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<FormDraft>;
    if (d?.v !== VERSION || typeof d.savedAt !== "number" || now - d.savedAt > DRAFT_MS || d.savedAt > now + 60_000) {
      store.removeItem(draftKey(formId));
      return null;
    }
    return d as FormDraft;
  } catch {
    clearDraft(formId);
    return null;
  }
}

export function saveDraft(formId: string, draft: FormDraft): void {
  try {
    storage()?.setItem(draftKey(formId), JSON.stringify(draft));
  } catch {
    // Full or blocked storage: the form works without a draft.
  }
}

export function clearDraft(formId: string): void {
  try {
    storage()?.removeItem(draftKey(formId));
  } catch {
    // Nothing to clear.
  }
}

/**
 * The form's state with the draft put back. Only what the form still asks
 * for is restored (a question removed since is dropped), values are checked
 * to be the right type, and details a request link locked stay as given.
 * Video answers start without a video.
 */
export function restoreDraft(draft: FormDraft, fresh: Answers, steps: FormPage[], locked: string[] = []): { state: Answers; step: number } {
  const answers = { ...fresh.answers };
  for (const [key, a] of Object.entries(record(draft.answers))) {
    const saved = record(a);
    if (!answers[key] || !isString(saved.text)) continue;
    // Only a "video or text" question keeps the person's choice; the others have one mode.
    const either = steps.some((p) => p.type === "question" && p.key === key && p.mode === "video_text");
    const mode = either && (saved.mode === "video" || saved.mode === "text") ? saved.mode : answers[key].mode;
    answers[key] = { ...answers[key], mode, text: saved.text };
  }
  const person = { ...fresh.person, socials: { ...fresh.person.socials } };
  const savedPerson = record(draft.person);
  for (const k of PERSON_KEYS) if (isString(savedPerson[k]) && !locked.includes(k)) person[k] = savedPerson[k] as string;
  const socials = record(savedPerson.socials);
  for (const k of SOCIAL_KEYS) if (isString(socials[k])) person.socials[k] = socials[k] as string;
  const custom: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(record(draft.custom))) if (isString(v) || typeof v === "boolean") custom[k] = v;
  const feedback: Record<string, string> = {};
  for (const [k, v] of Object.entries(record(draft.feedback))) if (isString(v)) feedback[k] = v;
  const rating = Number.isInteger(draft.rating) && draft.rating >= 0 && draft.rating <= 10 ? draft.rating : 0;

  const byId = steps.findIndex((p) => pageId(p) === draft.step?.id);
  const index = Number.isInteger(draft.step?.index) ? draft.step.index : 0;
  const step = byId >= 0 ? byId : Math.min(Math.max(index, 0), Math.max(steps.length - 1, 0));
  return { state: { ...fresh, rating, answers, feedback, person, custom }, step };
}
