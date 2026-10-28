import { notFound } from "next/navigation";
import { env } from "./env";

/**
 * Phase 1 ships behind feature flags (PRD §21): PLAUDIT_FEATURES is a comma
 * list of these, or "all". A flag only hides new navigation and pages; data,
 * APIs and existing pages behave the same either way. All on by default
 * since the Phase 1 release; PLAUDIT_FEATURES=none (or a shorter list) hides them.
 * Two Phase 2 flags also switch endpoints, not just pages: `api2` (the
 * /api/v1 CRUD and analytics paths, M14) and `mcp` (the /mcp server and its
 * OAuth). `team2` (M14) turns on roles, per-project access and the audit log.
 */
export const FEATURES = ["forms", "inbox2", "widgets", "walls", "importers", "notifications", "onboarding", "campaigns", "booster", "analytics", "share", "imports2", "customers", "translations", "aisearch", "api2", "mcp", "team2"] as const;
export type Feature = (typeof FEATURES)[number];

export function featureOn(f: Feature): boolean {
  const on = env.features;
  return on.includes("all") || on.includes(f);
}

/** For a page or route that belongs to a feature: a 404 while it's off. */
export function requireFeature(f: Feature): void {
  if (!featureOn(f)) notFound();
}
