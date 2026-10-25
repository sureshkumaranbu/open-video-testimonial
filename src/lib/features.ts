import { notFound } from "next/navigation";
import { env } from "./env";

/**
 * Phase 1 ships behind feature flags (PRD §21): PLAUDIT_FEATURES is a comma
 * list of these, or "all". A flag only hides new navigation and pages; data,
 * APIs and existing pages behave the same either way. Off until release.
 */
export const FEATURES = ["forms", "inbox2", "widgets", "walls", "importers", "notifications", "onboarding"] as const;
export type Feature = (typeof FEATURES)[number];

export function featureOn(f: Feature): boolean {
  const on = env.features;
  return on.includes("all") || on.includes(f);
}

/** For a page or route that belongs to a feature: a 404 while it's off. */
export function requireFeature(f: Feature): void {
  if (!featureOn(f)) notFound();
}
