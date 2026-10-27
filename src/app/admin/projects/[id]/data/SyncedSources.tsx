"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Icon } from "@/components/Icon";
import type { ImporterInfo } from "@/lib/importers/registry";
import type { SyncSourceJson } from "@/lib/importers/sync";

const WHEN = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const when = (iso: string | null) => (iso ? WHEN.format(new Date(iso)) : null);

/**
 * IMP-02 "Automatically synced": each source kept in sync, its last run and
 * how it went, the next run, what it has added, and pause, run now and stop.
 * Refreshes itself while a run is going.
 */
export function SyncedSources({ projectId, importers, version }: { projectId: string; importers: ImporterInfo[]; version: number }) {
  const [sources, setSources] = useState<SyncSourceJson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSources((await api<{ sources: SyncSourceJson[] }>(`/api/admin/projects/${projectId}/import-sources`)).sources);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const running = sources?.some((s) => s.running) ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!sources || (!sources.length && !error)) return null;
  const label = (id: string) => importers.find((i) => i.id === id)?.label ?? id;
  const base = `/api/admin/projects/${projectId}/import-sources`;

  return (
    <div className="stack" data-testid="synced-sources">
      <div>
        <h3>Automatically synced</h3>
        <p className="muted small">Checked on schedule; new reviews arrive with the options you chose. After 3 failed runs in a row you’re told, and it keeps trying.</p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="imp-synced" role="list">
        {sources.map((s) => (
          <li key={s.id} className="imp-synced-row" data-testid="synced-source" data-status={s.alerting ? "failing" : s.paused ? "paused" : s.running ? "running" : (s.lastStatus ?? "new")}>
            <div className="imp-synced-name">
              {/* eslint-disable-next-line @next/next/no-img-element -- a small static glyph */}
              <img src={`/importers/${s.adapter}.svg`} alt="" width={24} height={24} />
              <div style={{ minWidth: 0 }}>
                <strong className="small">{label(s.adapter)}</strong>
                {s.label && <div className="muted xsmall imp-synced-label">{s.label}</div>}
              </div>
            </div>
            <div className="small imp-synced-meta">
              <span data-testid="synced-last">
                {s.running
                  ? "Running now…"
                  : s.lastRunAt
                    ? `Last run ${when(s.lastRunAt)}: ${s.lastStatus === "failed" ? "failed" : "worked"}`
                    : "Not run on schedule yet"}
              </span>
              <span className="muted">
                {s.paused ? "Paused" : `Next ${when(s.nextRunAt) ?? "soon"}`} · every {s.intervalHours} h · {s.itemsAdded} added
              </span>
              {s.alerting && (
                <span className="error xsmall" role="alert" data-testid="synced-failing">
                  Failed {s.failures} times in a row{s.lastError ? `: ${s.lastError}` : ""}
                </span>
              )}
            </div>
            <div className="row imp-synced-actions">
              <button type="button" className="ghost small" disabled={busy === s.id} onClick={() => void act(s.id, () => api(`${base}/${s.id}`, { method: "PATCH", json: { paused: !s.paused } }))} data-testid="synced-pause">
                <Icon name={s.paused ? "play" : "pause"} />
                {s.paused ? "Resume" : "Pause"}
              </button>
              <button type="button" className="ghost small" disabled={busy === s.id || s.running} onClick={() => void act(s.id, () => api(`${base}/${s.id}/run`, { method: "POST" }))} data-testid="synced-run">
                <Icon name="refresh" />
                Run now
              </button>
              <button
                type="button"
                className="ghost small"
                disabled={busy === s.id}
                onClick={() => confirm(`Stop syncing ${label(s.adapter)}? What it imported stays.`) && void act(s.id, () => api(`${base}/${s.id}`, { method: "DELETE" }))}
                data-testid="synced-delete"
              >
                <Icon name="trash" />
                Stop syncing
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
