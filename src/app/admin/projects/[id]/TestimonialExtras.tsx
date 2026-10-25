"use client";

/** What the dashboard has for each testimonial; the Phase 1 columns arrive with the row as JSON. */
export type ExtrasTestimonial = {
  id: string;
  formId?: string | null;
  primaryQuestion?: string | null;
  /** JSON objects, as stored. */
  customFields?: string | null;
  hiddenFields?: string | null;
};

/**
 * A slot in each dashboard card for what multi-question forms add: the other
 * answers, custom and hidden fields and the form badge. Filled in by WP2.6, so
 * that work never has to touch Dashboard.tsx. Renders nothing for now.
 */
export function TestimonialExtras({ testimonial }: { testimonial: ExtrasTestimonial }) {
  return null;
}
