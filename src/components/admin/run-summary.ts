import type { RunProgress } from "@/lib/runs";

/** "12 of 50 · 3 already there · 1 failed": the counts that aren't zero. */
export function describeRun(run: Pick<RunProgress, "total" | "done" | "duplicates" | "skipped" | "failed">) {
  const parts = [run.total > 0 ? `${run.done} of ${run.total}` : `${run.done} done`];
  if (run.duplicates) parts.push(`${run.duplicates} already there`);
  if (run.skipped) parts.push(`${run.skipped} skipped`);
  if (run.failed) parts.push(`${run.failed} failed`);
  return parts.join(" · ");
}
