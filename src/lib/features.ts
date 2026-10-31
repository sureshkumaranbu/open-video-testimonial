import { notFound } from "next/navigation";
import { env } from "./env";

/**
 * Phase 1 ships behind feature flags (PRD §21): PLAUDIT_FEATURES is a comma
 * list of these, or "all". A flag hides its section's navigation and pages,
 * public ones too (B-04: named walls and /t/ with `walls`, /f/ and the form
 * iframe with `forms`, /b/ with `booster`, /cs/ with `insights`); data, APIs
 * and the pages from before Phase 1 (/c/, the main wall) behave the same either way. All on by default
 * since the Phase 1 release; PLAUDIT_FEATURES=none (or a shorter list) hides them.
 * Two Phase 2 flags also switch endpoints, not just pages: `api2` (the
 * /api/v1 CRUD and analytics paths, M14) and `mcp` (the /mcp server and its
 * OAuth). `team2` (M14) turns on roles, per-project access and the audit log.
 * `video2` (M16) shows multiclips, social clips, highlight reels and owner
 * videos on forms; the HLS copies have their own setting (VIDEO_HLS).
 * `insights` (M17) shows case studies and their public pages, Insights
 * (Voice of Customer, ask a question, NPS), surveys and screenshot OCR.
 * `commerce` (M18) shows the Stripe connection with its sales popup,
 * "Verified purchase" and thank-you coupons, and social post drafts; its
 * Stripe webhook answers 404 while it's off. The browser extension needs
 * only /api/v1, so it works either way.
 */
export const FEATURES = ["forms", "inbox2", "widgets", "walls", "importers", "notifications", "onboarding", "campaigns", "booster", "analytics", "share", "imports2", "customers", "translations", "aisearch", "api2", "mcp", "team2", "video2", "insights", "commerce"] as const;
export type Feature = (typeof FEATURES)[number];

export function featureOn(f: Feature): boolean {
  const on = env.features;
  return on.includes("all") || on.includes(f);
}

/** For a page or route that belongs to a feature: a 404 while it's off. */
export function requireFeature(f: Feature): void {
  if (!featureOn(f)) notFound();
}
