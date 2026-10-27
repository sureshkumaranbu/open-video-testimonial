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
  warnings: Note[];
  warningCount: number;
};

type Note = { line: number; message: string };

type ImportResult = {
  imported: number;
  skipped: { line: number; error: string }[];
  warnings: Note[];
  warningCount: number;
};

/** Values an import leaves out (an unreadable date or rating, say), line by line. */
function Warnings({ notes, count, intro }: { notes: Note[]; count: number; intro: string }) {
  if (count === 0) return null;
  return (
    <div className="small" data-testid="csv-warnings">
      <p>
        {intro} ({count}):
      </p>
      <ul className="notes">
        {notes.map((w, i) => (
          <li key={i}>
            Line {w.line}: {w.message}
          </li>
        ))}
      </ul>
      {count > notes.length && <p className="muted">…and {count - notes.length} more.</p>}
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  name: "Name (required)",
  email: "Email",
  title: "Job title",
  headline: "Headline",
  company: "Company",
  text: "Testimonial text",
  rating: "Rating",
  date: "Date",
  tags: "Tags",
  avatarUrl: "Photo URL",
  videoUrl: "Video URL",
  platform: "Source platform",
  sourceReviewId: "Original ID",
};

const ORIGIN_LABEL: Record<string, string> = {
  plaudit: "a Plaudit CSV export",
  senja: "a Senja-style file",
  "testimonial-to": "a Testimonial.to-style file",
  shapo: "a Shapo-style file",
  csv: "a CSV file",
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * CSV import with the column mapper, and the project export. With `sheets`
 * (the imports2 flag, IMP-04) it also takes .xlsx files and a table pasted
 * from a spreadsheet, both read into the same mapper, preview and warnings.
 */
export function DataTools({ projectId, total, fields, sheets = false }: { projectId: string; total: number; fields: string[]; sheets?: boolean }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [approve, setApprove] = useState(false);
  const [fetchMedia, setFetchMedia] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasting, setPasting] = useState(false);

  /** Starts the mapper on some CSV (or tab-separated) text. */
  async function load(text: string, name: string) {
    setFileName(name);
    setCsv(text);
    setResult(null);
    await refresh(text);
  }

  /** IMP-04: the server reads the spreadsheet's first sheet into CSV for the mapper. */
  async function loadXlsx(file: File) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/import-csv/xlsx`, { method: "POST", headers: { "Content-Type": XLSX_TYPE }, body: file });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      await load(json.csv as string, file.name);
      if (json.truncated) setError("Only the first 10,000 rows and 100 columns of the sheet were read.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
            {sheets ? "Import testimonials from a spreadsheet or CSV" : "Import testimonials from a CSV"}
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
            {fileName || (sheets ? "Choose a CSV or Excel file" : "Choose a CSV file")}
            <input
              type="file"
              accept={sheets ? `.csv,.tsv,.xlsx,text/csv,text/plain,${XLSX_TYPE}` : ".csv,text/csv,text/plain"}
              data-testid="csv-file"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (sheets && (/\.xlsx$/i.test(file.name) || file.type === XLSX_TYPE)) return void loadXlsx(file);
                await load(await file.text(), file.name);
              }}
            />
          </label>
          {sheets && (
            <div className="stack">
              <button type="button" className="ghost small" style={{ alignSelf: "flex-start" }} aria-expanded={pasting} onClick={() => setPasting((v) => !v)} data-testid="paste-toggle">
                Or paste a table from a spreadsheet
              </button>
              {pasting && (
                <div className="stack">
                  <label className="small">
                    Copy the cells with their header row (from Excel, Google Sheets or Numbers) and paste them here
                    <textarea
                      rows={6}
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      placeholder={"Name\tTestimonial\tRating\nAda Lovelace\tIt just works.\t5"}
                      spellCheck={false}
                      data-testid="paste-table"
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary small"
                    style={{ alignSelf: "flex-start" }}
                    disabled={!pasted.trim() || busy}
                    onClick={() => void load(pasted, "Pasted table")}
                    data-testid="paste-preview"
                  >
                    Read the table
                  </button>
                </div>
              )}
            </div>
          )}

          {preview && csv && (
            <div className="stack" data-testid="csv-preview">
              <p className="small" data-testid="csv-summary">
                Looks like {ORIGIN_LABEL[preview.origin] ?? (sheets ? "a spreadsheet" : "a CSV file")}: {preview.total} rows, {preview.valid} ready to import.
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
              <Warnings notes={preview.warnings} count={preview.warningCount} intro="These rows will import, but without some values" />
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
                      const res = await post<ImportResult>(`/api/admin/projects/${projectId}/import-csv`, {
                        csv,
                        mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
                        approve,
                        fetchMedia,
                      });
                      setResult(res);
                      setPreview(null);
                      setCsv(null);
                      setFileName("");
                      setPasted("");
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
            <div className="notice stack" role="status" data-testid="import-result">
              <p>
                Imported {result.imported} testimonial{result.imported === 1 ? "" : "s"}
                {result.skipped.length ? `, skipped ${result.skipped.length}` : ""}.{" "}
                <a href={`/admin/projects/${projectId}`}>Review them</a>
              </p>
              {result.skipped.length > 0 && (
                <p className="small">
                  Skipped: {result.skipped.map((e) => `line ${e.line} (${e.error})`).join(", ")}
                </p>
              )}
              <Warnings notes={result.warnings} count={result.warningCount} intro="Imported without some values" />
            </div>
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
