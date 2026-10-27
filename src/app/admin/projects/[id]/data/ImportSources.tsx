"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/app/admin/api";
import type { ImporterInfo } from "@/lib/importers/registry";
import type { RunProgress } from "@/lib/runs";
import "../../../import.css";
import { importSummary } from "./ImportProgress";
import { ImportWizard } from "./ImportWizard";

const WHEN = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Import from review sites and other testimonial tools (IMP-01): a source
 * picker, the import flow for the chosen one, and the recent imports.
 * Shown only with the `importers` feature on.
 */
export function ImportSources({ projectId, importers }: { projectId: string; importers: ImporterInfo[] }) {
  const [open, setOpen] = useState<ImporterInfo | null>(null);
  const [runs, setRuns] = useState<RunProgress[]>([]);
  const load = useCallback(async () => {
    try {
      setRuns((await api<{ runs: RunProgress[] }>(`/api/admin/projects/${projectId}/imports`)).runs);
    } catch {
      // The history is a nicety; the picker works without it.
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const label = (id: string | null) => importers.find((i) => i.id === id)?.label ?? id ?? "Import";
  const group = (kind: ImporterInfo["kind"], title: string, intro: string) => (
    <div className="stack">
      <div>
        <h3>{title}</h3>
        <p className="muted small">{intro}</p>
      </div>
      <ul className="imp-sources" role="list">
        {importers
          .filter((i) => i.kind === kind)
          .map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="imp-source"
                aria-pressed={open?.id === i.id}
                data-testid={`import-source-${i.id}`}
                onClick={() => setOpen(open?.id === i.id ? null : i)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a small static glyph */}
                <img src={`/importers/${i.id}.svg`} alt="" width={28} height={28} />
                <span className="imp-source-name">{i.label}</span>
                {!i.available && <span className="imp-source-note">Needs setup</span>}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );

  return (
    <section className="panel" aria-labelledby="imp-h" data-testid="import-sources">
      <div className="panel-head">
        <h2 id="imp-h">Import from review sites and other tools</h2>
      </div>
      <div className="panel-body stack-lg">
        {group("platform", "Review sites", "Bring in reviews of your own business, app or product. Re-running an import never adds the same review twice.")}
        {group("migration", "Move from another testimonial tool", "Text, ratings and videos come across; videos are downloaded in the background.")}
        {open && <ImportWizard key={open.id} projectId={projectId} importer={open} onClose={() => setOpen(null)} onImported={() => void load()} />}
        {runs.length > 0 && (
          <div className="stack">
            <h3>Recent imports</h3>
            <ul className="notes small" data-testid="import-history">
              {runs.map((r) => (
                <li key={r.id}>
                  {label(r.subject)}, {WHEN.format(new Date(r.createdAt))}:{" "}
                  {r.status === "done" ? importSummary(r) : r.status === "failed" ? `stopped early (${r.errors[0]?.message ?? "an error"})` : "running…"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
