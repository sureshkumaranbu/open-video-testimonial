"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import type { RunProgress } from "@/lib/runs";
import { api } from "../api";

type Status = {
  storage: {
    driver: "local" | "s3";
    bucket: string | null;
    endpoint: string | null;
    prefix: string | null;
    ok: boolean;
    error: string | null;
    localFiles: number;
  };
  migration: RunProgress | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function summary(run: RunProgress) {
  const parts = [`${plural(run.done, "file")} copied`];
  if (run.duplicates) parts.push(`${run.duplicates.toLocaleString()} already in the bucket`);
  if (run.skipped) parts.push(`${run.skipped.toLocaleString()} gone from disk`);
  if (run.failed) parts.push(`${run.failed.toLocaleString()} failed`);
  return parts.join(", ");
}

/**
 * Settings → Media storage (TEAM-05): local disk or an S3-compatible bucket,
 * whether it works, and the owner's "Copy local media to S3" task with its
 * progress.
 */
export function StorageStatus({ isOwner }: { isOwner: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [run, setRun] = useState<RunProgress | null>(null);
  const [deleteLocal, setDeleteLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api<Status>("/api/admin/system/storage");
      setStatus(body);
      setRun(body.migration);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Poll the run while it's going; refresh the file count when it ends.
  const running = Boolean(run && !run.finished);
  const runId = run?.id;
  useEffect(() => {
    if (!running || !runId) return;
    const timer = setInterval(async () => {
      try {
        const { run: next } = await api<{ run: RunProgress }>(`/api/admin/runs/${runId}`);
        setRun(next);
        if (next.finished) void load();
      } catch {
        // Try again on the next tick.
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [running, runId, load]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { run: started } = await api<{ run: RunProgress }>("/api/admin/system/storage", {
        method: "POST",
        body: JSON.stringify({ deleteLocal }),
      });
      setRun(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const s = status?.storage;
  return (
    <section className="panel" aria-labelledby="storage-h" data-testid="storage-status">
      <div className="panel-head">
        <h2 id="storage-h" style={{ fontSize: "var(--text-base)" }}>
          Media storage
        </h2>
      </div>
      {!s ? (
        <div className="panel-body">
          {error ? (
            <p className="notice warn" role="alert">
              {error}
            </p>
          ) : (
            <p className="muted small" role="status">
              Checking storage…
            </p>
          )}
        </div>
      ) : (
        <div className="panel-body stack">
          <dl className="status-list">
            <dt>Where</dt>
            <dd>{s.driver === "s3" ? `S3-compatible bucket “${s.bucket ?? ""}”${s.prefix ? `, folder ${s.prefix}` : ""}` : "Local disk (DATA_DIR/uploads)"}</dd>
            {s.driver === "s3" && (
              <>
                <dt>Endpoint</dt>
                <dd style={{ overflowWrap: "anywhere" }}>{s.endpoint}</dd>
              </>
            )}
            <dt>Status</dt>
            <dd data-on={s.ok} data-testid="storage-health">
              {s.ok ? "Working" : `Not working: ${s.error}`}
            </dd>
            <dt>Files on local disk</dt>
            <dd>{s.localFiles.toLocaleString()}</dd>
          </dl>

          {s.driver === "local" && (
            <p className="muted small">
              To keep media in an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO and others), set STORAGE_DRIVER=s3 and the S3_*
              settings, restart Plaudit, then copy the files already here.
            </p>
          )}

          {s.driver === "s3" && run && (
            <div className="stack" data-testid="storage-run" aria-live="polite">
              {run.finished ? (
                <p className={run.status === "failed" || run.failed ? "notice warn" : "notice"} role="status">
                  {run.status === "failed" ? "The copy stopped. " : "Copy finished: "}
                  {summary(run)}.
                </p>
              ) : (
                <>
                  <p className="small" role="status">
                    {run.status === "queued"
                      ? "Starting the copy…"
                      : `Copying… ${(run.done + run.duplicates + run.skipped + run.failed).toLocaleString()} of ${plural(run.total, "file")}`}
                  </p>
                  <progress max={100} value={run.percent ?? undefined} aria-label="Copy progress" style={{ width: "100%" }} />
                </>
              )}
              {run.errors.length > 0 && (
                <ul className="small muted" data-testid="storage-run-errors">
                  {run.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>
                      {e.item ? <code>{e.item}</code> : null}
                      {e.item ? ": " : ""}
                      {e.message}
                    </li>
                  ))}
                  {run.errorCount > 5 && <li>…and {plural(run.errorCount - 5, "more problem")}</li>}
                </ul>
              )}
            </div>
          )}

          {s.driver === "s3" &&
            (isOwner ? (
              <div className="stack">
                <label className="check">
                  <input type="checkbox" checked={deleteLocal} onChange={(e) => setDeleteLocal(e.target.checked)} disabled={running} />
                  Delete each file from local disk once it&apos;s in the bucket
                </label>
                <div className="row">
                  <button type="button" className="secondary" onClick={start} disabled={busy || running || !s.ok || s.localFiles === 0}>
                    <Icon name="upload" />
                    {running ? "Copying…" : "Copy local media to S3"}
                  </button>
                </div>
                <p className="hint xsmall">
                  {s.localFiles === 0
                    ? "There's nothing on local disk to copy."
                    : "Files already in the bucket are skipped, so it's safe to run again. Until a file is copied it's still served from local disk."}
                </p>
              </div>
            ) : (
              <p className="muted small">Only the owner can copy local media to the bucket.</p>
            ))}

          {error && (
            <p className="notice warn" role="alert" data-testid="storage-message">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
