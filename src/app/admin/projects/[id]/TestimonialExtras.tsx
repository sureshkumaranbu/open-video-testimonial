"use client";

import { AnswersPanel } from "./AnswersPanel";

/** What the dashboard has for each testimonial; the Phase 1 columns arrive with the row as JSON. */
export type ExtrasTestimonial = {
  id: string;
  formId?: string | null;
  primaryQuestion?: string | null;
  /** JSON objects, as stored. */
  customFields?: string | null;
  hiddenFields?: string | null;
  /** When the dashboard re-reads a row, the panel reads its answers again. */
  updatedAt?: string | number | null;
};

function readJson(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * What multi-question forms add to each dashboard card (WP2.6): the form it
 * came through, the question the main text answers, the other answers with
 * their videos, private feedback, custom fields and the hidden fields from
 * the link. Owner-only: none of this is public.
 */
export function TestimonialExtras({ testimonial: t }: { testimonial: ExtrasTestimonial }) {
  const custom = readJson(t.customFields);
  const hidden = readJson(t.hiddenFields);
  if (!t.formId && !Object.keys(custom).length && !Object.keys(hidden).length) return null;
  return <AnswersPanel id={t.id} hasForm={Boolean(t.formId)} primaryQuestion={t.primaryQuestion ?? null} custom={custom} hidden={hidden} version={t.updatedAt ?? null} />;
}
