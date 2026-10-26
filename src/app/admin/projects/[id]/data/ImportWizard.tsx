"use client";

import { useMemo, useState, type FormEvent } from "react";
import { api, errorMessage, isApiError } from "@/app/admin/api";
import { Checkbox } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { PlatformIcon, platformLabel } from "@/components/PlatformIcon";
import { Stars } from "@/components/TestimonialCard";
import { formatSourceDate } from "@/lib/dates";
import type { ImporterInfo } from "@/lib/importers/registry";
import type { PreviewItem } from "@/lib/importers/types";
import type { RunProgress } from "@/lib/runs";
import { ImportProgress, importSummary } from "./ImportProgress";

type Preview = { run: RunProgress; items: PreviewItem[]; more: boolean };

const METHOD_LABEL: Record<ImporterInfo["method"], string> = {
  "official-api": "Official API",
  feed: "Public feed",
  "structured-data": "Public page data",
  "page-parse": "Reads the public page",
  oembed: "Official embed",
  file: "Export file",
  "api-key": "Your API key",
};

/**
 * One flow for every source (IMP-01): identify → options → preview of the
 * latest 50 → pick some or all → background import with progress → summary.
 * The ownership box is also checked on the server (IMP-03).
 */
export function ImportWizard({ projectId, importer, onClose, onImported }: { projectId: string; importer: ImporterInfo; onClose: () => void; onImported?: (run: RunProgress) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [minRating, setMinRating] = useState("");
  const [skipEmpty, setSkipEmpty] = useState(false);
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<"pending" | "approved">("pending");
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; blocked: boolean } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runId, setRunId] = useState<string | null>(null);
  const [finished, setFinished] = useState<RunProgress | null>(null);

  const options = () => ({
    minRating: minRating ? Number(minRating) : null,
    skipEmpty,
    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    status,
  });

  const handle = (e: unknown) => {
    const data = isApiError(e) ? (e.data as { code?: string } | undefined) : undefined;
    setError({ message: errorMessage(e), blocked: data?.code === "blocked" });
  };

  const showPreview = (p: Preview) => {
    setPreview(p);
    setSelected(new Set(p.items.filter((i) => !i.alreadyImported).map((i) => i.id)));
  };

  async function runPreview(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      showPreview(await api<Preview>(`/api/admin/projects/${projectId}/imports/preview`, { method: "POST", json: { adapter: importer.id, input, options: options(), confirmOwnership: owner } }));
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File, kind: "html" | "file") {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("adapter", importer.id);
      form.set("options", JSON.stringify(options()));
      form.set("confirmOwnership", String(owner));
      form.set(kind, file);
      showPreview(await api<Preview>(`/api/admin/projects/${projectId}/imports/preview`, { method: "POST", body: form }));
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  async function start(selection: "all" | string[]) {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const { run } = await api<{ run: RunProgress }>(`/api/admin/runs/${preview.run.id}/import`, { method: "POST", json: { selection } });
      setRunId(run.id);
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  }

  const items = preview?.items ?? [];
  const selectable = useMemo(() => items.filter((i) => !i.alreadyImported), [items]);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const uploadBox = (importer.acceptsHtml || importer.upload) && (
    <div className="imp-upload stack" data-testid="import-upload" data-emphasis={error?.blocked ? "true" : undefined}>
      {importer.acceptsHtml && (
        <label className="button secondary small imp-file">
          <Icon name="upload" />
          Upload the saved page instead
          <input
            type="file"
            accept=".html,.htm,text/html"
            className="visually-hidden"
            data-testid="import-html-file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f, "html");
            }}
          />
        </label>
      )}
      {importer.upload && (
        <label className="button secondary small imp-file">
          <Icon name="upload" />
          {importer.upload.label}
          <input
            type="file"
            accept={importer.upload.accept}
            className="visually-hidden"
            data-testid="import-export-file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f, "file");
            }}
          />
        </label>
      )}
      {importer.acceptsHtml && (
        <p className="hint">
          In your browser, open the page with the reviews showing, choose File → Save page as (HTML only), then upload that file here.
        </p>
      )}
    </div>
  );

  return (
    <section className="panel imp-wizard" aria-labelledby="imp-wizard-h" data-testid="import-wizard" data-source={importer.id}>
      <div className="panel-head">
        <h3 id="imp-wizard-h" className="row" style={{ gap: "var(--space-2)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a small static glyph */}
          <img src={`/importers/${importer.id}.svg`} alt="" width={24} height={24} />
          Import from {importer.label}
        </h3>
        <button type="button" className="button ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="panel-body stack">
        <p className="muted small">
          <span className="badge">{METHOD_LABEL[importer.method]}</span> {importer.tosNotes}
        </p>

        {runId ? (
          <div className="stack">
            <ImportProgress
              runId={runId}
              onFinished={(run) => {
                setFinished(run);
                onImported?.(run);
              }}
            />
            {finished && (
              <p role="status">
                {finished.status === "done" ? `Done: ${importSummary(finished)}.` : "The import stopped early."} The new testimonials are in the Testimonials tab
                {status === "pending" ? ", waiting in Pending" : ""}.
              </p>
            )}
            {finished && (
              <div className="row">
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    setRunId(null);
                    setFinished(null);
                    setPreview(null);
                  }}
                >
                  Import more
                </button>
                <button type="button" className="button ghost small" onClick={onClose}>
                  Done
                </button>
              </div>
            )}
          </div>
        ) : preview ? (
          <div className="stack" data-testid="import-preview">
            <div className="row imp-preview-head">
              <p className="small" role="status">
                {items.length === 0
                  ? "Nothing matches your options. Go back and loosen them."
                  : `${preview.more ? `The latest ${items.length}` : items.length === 1 ? "1 testimonial" : `All ${items.length}`} matching${preview.more ? " (there are more)" : ""}. ${selected.size} selected.`}
              </p>
              <button type="button" className="button ghost small" onClick={() => setPreview(null)}>
                Back
              </button>
            </div>
            {selectable.length > 1 && (
              <Checkbox
                label="Select all"
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                onChange={(on) => setSelected(on ? new Set(selectable.map((i) => i.id)) : new Set())}
                testId="import-select-all"
              />
            )}
            <ul className="imp-items" data-testid="import-items">
              {items.map((item) => (
                <li key={item.id} className="imp-item" data-testid="import-item" data-imported={item.alreadyImported ? "true" : undefined}>
                  <Checkbox
                    label={`Select ${item.authorName}`}
                    hideLabel
                    checked={selected.has(item.id)}
                    disabled={item.alreadyImported}
                    onChange={(on) => toggle(item.id, on)}
                  />
                  <div className="imp-item-body">
                    <div className="row imp-item-meta">
                      <strong>{item.authorName}</strong>
                      {item.rating !== null && <Stars rating={item.rating} />}
                      {item.date && <span className="muted small" data-testid="import-item-date">{formatSourceDate(new Date(item.date), item.datePrecision, "en")}</span>}
                      {item.platform && item.platform !== importer.platform && (
                        <span className="muted small row" style={{ gap: 4 }}>
                          <PlatformIcon platform={item.platform} /> {platformLabel(item.platform)}
                        </span>
                      )}
                      {item.videoUrl && <span className="badge">Video</span>}
                      {item.alreadyImported && <span className="badge">Already imported</span>}
                    </div>
                    {item.headline && <p className="imp-item-headline">{item.headline}</p>}
                    {item.text && <p className="imp-item-text">{item.text}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {error && (
              <p className="error" role="alert">
                {error.message}
              </p>
            )}
            {items.length > 0 && (
              <div className="row">
                <button type="button" className="button small" disabled={busy || selected.size === 0} onClick={() => void start([...selected])} data-testid="import-selected">
                  Import selected ({selected.size})
                </button>
                <button type="button" className="button secondary small" disabled={busy} onClick={() => void start("all")} data-testid="import-all">
                  Import all matching{preview.more ? " (up to 1,000)" : ""}
                </button>
              </div>
            )}
          </div>
        ) : (
          <form className="stack" onSubmit={runPreview} data-testid="import-identify">
            {!importer.available && (
              <p className="error" role="alert">
                {importer.missing}. Add it to the server’s settings, then reload this page{importer.upload || importer.acceptsHtml ? ", or upload a file below" : ""}.
              </p>
            )}
            {importer.fields.map((f) => (
              <label key={f.key} className="imp-field">
                <span>
                  {f.label}
                  {f.optional && <span className="muted"> (optional)</span>}
                </span>
                {f.type === "textarea" ? (
                  <textarea rows={4} value={values[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <input
                    type={f.type === "password" ? "password" : f.type === "url" ? "url" : "text"}
                    autoComplete="off"
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
                {f.hint && <span className="hint">{f.hint}</span>}
              </label>
            ))}

            <fieldset className="imp-options stack">
              <legend>Options</legend>
              <div className="row">
                <label className="imp-field">
                  <span>Minimum rating</span>
                  <select value={minRating} onChange={(e) => setMinRating(e.target.value)}>
                    <option value="">Any rating</option>
                    {[5, 4, 3, 2].map((n) => (
                      <option key={n} value={n}>
                        {n === 5 ? "5 stars only" : `${n} stars and up`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="imp-field">
                  <span>Tags to add</span>
                  <input type="text" value={tags} placeholder="google, 2026" onChange={(e) => setTags(e.target.value)} />
                </label>
                <label className="imp-field">
                  <span>Status after import</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value as "pending" | "approved")}>
                    <option value="pending">Pending (review first)</option>
                    <option value="approved">Approved</option>
                  </select>
                </label>
              </div>
              <Checkbox label="Skip reviews with no text" checked={skipEmpty} onChange={setSkipEmpty} />
            </fieldset>

            <Checkbox label="I own or manage this listing" checked={owner} onChange={setOwner} testId="import-ownership" />
            <p className="hint">Only import reviews of your own business, app or product. The reviewers agreed to the site’s terms, not Plaudit’s, so keep your own record of consent.</p>

            {error && (
              <p className="error" role="alert" data-testid={error.blocked ? "import-blocked" : undefined}>
                {error.message}
                {error.blocked && importer.acceptsHtml ? " Upload the saved page instead (below)." : ""}
              </p>
            )}
            <div className="row">
              <button type="submit" className="button small" disabled={busy || (!importer.available && importer.fields.length > 0)} data-testid="import-preview-button">
                {busy ? "Fetching…" : "Preview"}
              </button>
            </div>
            {uploadBox}
          </form>
        )}
      </div>
    </section>
  );
}
