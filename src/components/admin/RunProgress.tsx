"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage, isApiError } from "@/app/admin/api";
import type { RunProgress as Run } from "@/lib/runs";
import { ProgressBar } from "./ProgressBar";
import { describeRun } from "./run-summary";

/**
 * Follows a background task run (an import, the copy of local media to S3,
 * onboarding discovery) through GET /api/admin/runs/[id]. It polls only while
 * the run is queued or running, one request at a time, and stops when the
 * run finishes or the component goes.
 */
export function useRunProgress(runId: string | null, o: { intervalMs?: number } = {}) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const every = o.intervalMs ?? 1000;

  useEffect(() => {
    setRun(null);
    setError(null);
    setRetrying(false);
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const { run } = await api<{ run: Run }>(`/api/admin/runs/${encodeURIComponent(runId)}`, { signal: ctrl.signal });
        if (stopped) return;
        setRun(run);
        setError(null);
        setRetrying(false);
        if (!run.finished) timer = setTimeout(tick, every);
      } catch (e) {
        if (stopped) return;
        setError(errorMessage(e));
        // Signed out, or no such run: asking again won't help.
        const retry = !isApiError(e, 401, 403, 404);
        setRetrying(retry);
        // A blip (a restart, a lost connection) shouldn't end the watch; slow down and retry.
        if (retry) timer = setTimeout(tick, every * 3);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [runId, every]);

  /** `error` is the last failed poll; `retrying` says whether it will ask again. */
  return { run, error, retrying };
}

export type RunProgressViewProps = {
  runId: string;
  label: string;
  /** Called once when the run ends, done or failed. */
  onFinished?: (run: Run) => void;
  /** Replaces the counts line under the bar. */
  describe?: (run: Run) => ReactNode;
  testId?: string;
};

/** A progress bar for a run, with its counts and the first problems it hit. */
export function RunProgressView({ runId, label, onFinished, describe = describeRun, testId }: RunProgressViewProps) {
  const { run, error, retrying } = useRunProgress(runId);
  const reported = useRef<string | null>(null);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });
  useEffect(() => {
    if (run?.finished && reported.current !== run.id) {
      reported.current = run.id;
      finished.current?.(run);
    }
  }, [run]);

  return (
    <div className="ak-run stack" data-testid={testId} data-status={run?.status ?? "loading"}>
      <ProgressBar label={label} value={run?.percent ?? null} detail={run ? describe(run) : "Starting…"} />
      {run?.status === "failed" && (
        <p className="error" role="alert">
          This stopped before it finished. {run.errors[0]?.message ?? "Try again."}
        </p>
      )}
      {run && run.errorCount > 0 && run.status !== "failed" && (
        <details className="ak-run-errors">
          <summary>
            {run.errorCount} {run.errorCount === 1 ? "problem" : "problems"}
          </summary>
          <ul className="notes">
            {run.errors.map((e, i) => (
              <li key={i}>{e.item ? `${e.item}: ${e.message}` : e.message}</li>
            ))}
          </ul>
          {run.errorCount > run.errors.length && <p className="hint">And {run.errorCount - run.errors.length} more.</p>}
        </details>
      )}
      {error && !run?.finished && (
        <p className={retrying ? "muted small" : "error"} role={retrying ? "status" : "alert"}>
          Can&apos;t get the latest progress ({error.replace(/\.$/, "")}).{retrying ? " Still trying…" : " Reload the page to check again."}
        </p>
      )}
    </div>
  );
}
