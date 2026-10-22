"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

type Preview = {
  headers: string[];
  mapping: Record<string, string | undefined>;
  origin: string;
  total: number;
  valid: number;
  rows: Record<string, unknown>[];
  errors: { line: number; error: string }[];
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name (required)",
  email: "Email",
  title: "Job title",
  company: "Company",
  text: "Testimonial text",
  rating: "Rating",
  date: "Date",
  tags: "Tags",
  avatarUrl: "Photo URL",
  videoUrl: "Video URL",
};

const ORIGIN_LABEL: Record<string, string> = {
  plaudit: "a Plaudit CSV export",
  senja: "a Senja-style file",
  "testimonial-to": "a Testimonial.to-style file",
  csv: "a CSV file",
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export function DataTools({ projectId, total, fields }: { projectId: string; total: number; fields: string[] }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [approve, setApprove] = useState(false);
  const [fetchMedia, setFetchMedia] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function refresh(text: string, map?: Record<string, string>) {
    setError(null);
    try {
      const p = await post<Preview>(`/api/admin/projects/${projectId}/import-csv/preview`, { csv: text, mapping: map });
      setPreview(p);
      setMapping(Object.fromEntries(fields.map((f) => [f, p.mapping[f] ?? ""])));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="workspace">
      <section className="panel" aria-labelledby="import-h">
        <div className="panel-head">
          <h2 id="import-h" style={{ fontSize: "var(--text-base)" }}>
            Import testimonials from a CSV
          </h2>
        </div>
        <div className="panel-body stack">
          <p className="muted small">
            From a spreadsheet, or a CSV exported from another testimonial tool. Columns are matched automatically;
            check the matches below before importing. Imported testimonials are marked as imported in their consent
            record, because consent was collected outside Plaudit.
          </p>
          <label className="button secondary small" style={{ flexDirection: "row", alignSelf: "flex-start" }}>
            <Icon name="upload" />
            {fileName || "Choose a CSV file"}
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              data-testid="csv-file"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const text = await file.text();
                setFileName(file.name);
                setCsv(text);
                setResult(null);
                await refresh(text);
              }}
            />
          </label>

          {preview && csv && (
            <div className="stack" data-testid="csv-preview">
              <p className="small">
                Looks like {ORIGIN_LABEL[preview.origin] ?? "a CSV file"}: {preview.total} rows, {preview.valid} ready to import.
              </p>
              <div className="mapping-grid">
                {fields.map((f) => (
                  <label key={f} className="small">
                    {FIELD_LABEL[f] ?? f}
                    <select
                      value={mapping[f] ?? ""}
                      onChange={async (e) => {
                        const next = { ...mapping, [f]: e.target.value };
                        setMapping(next);
                        await refresh(csv, Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
                      }}
                    >
                      <option value="">(skip)</option>
                      {preview.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {preview.rows.length > 0 && (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Name</th>
                        <th>Text</th>
                        <th>Rating</th>
                        <th>Video</th>
                        <th>Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={String(r.line)} data-testid="preview-row">
                          <td>{String(r.line)}</td>
                          <td>{String(r.name ?? "")}</td>
                          <td>{String(r.text ?? "").slice(0, 80)}</td>
                          <td>{r.rating ? `${r.rating}/5` : ""}</td>
                          <td>{r.videoUrl ? "yes" : ""}</td>
                          <td className="error-text">{String(r.error ?? "")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.errors.length > 0 && (
                <p className="muted small">
                  Rows that will be skipped: {preview.errors.map((e) => `line ${e.line} (${e.error})`).join(", ")}
                </p>
              )}
              <label className="check small">
                <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
                Approve imported testimonials (otherwise they wait in Pending)
              </label>
              <label className="check small">
                <input type="checkbox" checked={fetchMedia} onChange={(e) => setFetchMedia(e.target.checked)} />
                Download videos and photos from the URLs in the file (public addresses only)
              </label>
              <div>
                <button
                  type="button"
                  disabled={busy || preview.valid === 0}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const res = await post<{ imported: number; skipped: { line: number; error: string }[] }>(
                        `/api/admin/projects/${projectId}/import-csv`,
                        { csv, mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), approve, fetchMedia },
                      );
                      setResult(
                        `Imported ${res.imported} testimonial${res.imported === 1 ? "" : "s"}` +
                          (res.skipped.length ? `, skipped ${res.skipped.length}` : "") +
                          ".",
                      );
                      setPreview(null);
                      setCsv(null);
                      setFileName("");
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Importing…" : `Import ${preview.valid} testimonial${preview.valid === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}
          {result && (
            <p className="notice" role="status">
              {result} <a href={`/admin/projects/${projectId}`}>Review them</a>
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      <aside className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: "var(--text-base)" }}>Export</h2>
        </div>
        <div className="panel-body stack">
          <p className="muted small">
            Everything in one .zip: all {total} testimonials with private fields, tags, consent history, requests and
            settings (<code>plaudit.json</code>), a spreadsheet (<code>testimonials.csv</code>) and every video and photo.
            Import it on any Plaudit server to move or restore this project. It contains personal data, so store it
            securely.
          </p>
          <a className="button" href={`/api/admin/projects/${projectId}/export`} download data-testid="export-zip">
            <Icon name="download" />
            Download everything (.zip)
          </a>
          <a className="button secondary small" href={`/api/admin/projects/${projectId}/export?format=csv`} download data-testid="export-csv">
            Spreadsheet only (.csv)
          </a>
        </div>
      </aside>
    </div>
  );
}
