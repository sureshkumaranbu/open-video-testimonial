"use client";

import { RunProgressView } from "@/components/admin";
import type { RunProgress } from "@/lib/runs";

/** "20 new, 3 already imported · 2 skipped · 1 failed": what an import did. */
export function importSummary(run: Pick<RunProgress, "done" | "duplicates" | "skipped" | "failed">) {
  const parts = [`${run.done} new, ${run.duplicates} already imported`];
  if (run.skipped) parts.push(`${run.skipped} skipped by your options`);
  if (run.failed) parts.push(`${run.failed} failed`);
  return parts.join(" · ");
}

/** The progress of an import run, then its summary. */
export function ImportProgress({ runId, onFinished }: { runId: string; onFinished?: (run: RunProgress) => void }) {
  return (
    <RunProgressView
      runId={runId}
      label="Importing"
      testId="import-progress"
      onFinished={onFinished}
      describe={(run) => (
        <span data-testid={run.finished ? "import-summary" : undefined}>
          {run.finished ? importSummary(run) : run.total > 0 ? `${run.done + run.duplicates + run.skipped + run.failed} of ${run.total}` : `${run.done} imported so far…`}
        </span>
      )}
    />
  );
}
