import { env } from "../env";
import { featureOn } from "../features";
import { registerPeriodic } from "../jobs";
import { ROLLUP_TASK, runAnalyticsTask } from "./rollup";

/**
 * Cookieless analytics (M11): collect.ts takes events in, rollup.ts turns
 * them into daily totals and watches widget installs, report.ts reads them
 * for the dashboard. What is and isn't kept: docs/help/analytics.md.
 */
export * from "./collect";
export * from "./rollup";
export * from "./report";

/** The analytics pages and panels show only with the `analytics` flag on and ANALYTICS not "off". */
export const analyticsUi = () => env.analytics && featureOn("analytics");

/** Hourly: install detection, the rollup of finished days, then deleting raw events past 30 days. */
export function registerAnalyticsJobs(): void {
  registerPeriodic(ROLLUP_TASK, 60 * 60 * 1000, () => runAnalyticsTask());
}
