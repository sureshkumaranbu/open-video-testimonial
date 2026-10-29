"use client";

import "@/app/admin/insights.css";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, EmptyState, Modal, Tabs, Toggle } from "@/components/admin";
import { BarList, fmt, Tile } from "@/components/analytics/charts";
import { presetRange, RangePicker, type Range } from "@/components/analytics/RangePicker";
import { Icon } from "@/components/Icon";
import type { NpsSummary } from "@/lib/insights/nps";
import { AI_HELP_URL } from "@/lib/insights/links";
import type { Counted } from "@/lib/insights/text";
import type { AskResult, VocReport } from "@/lib/insights/voc";

type Source = "testimonials" | "survey";
type Report = { id: string; kind: "voc" | "ask" | "nps"; name: string; params: Record<string, unknown>; result?: Record<string, unknown>; createdBy: string | null; createdAt: string };
type Saved = { kind: Report["kind"]; params: Record<string, unknown>; result: unknown };

const qs = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => Boolean(e[1]))).toString();

/**
 * VOC-01 and NPS-01: the Insights page. Voice of Customer (breakdown, words
 * and phrases, what they love and what to improve, and AI themes on
 * request), Ask a question, the NPS dashboard, and saved reports with CSV.
 * Everything works without AI; anything sent to the provider is sent only
 * when an editor presses the button that says so.
 */
export function Insights({
  projectId,
  tags,
  forms,
  ai: initialAi,
  role,
}: {
  projectId: string;
  tags: string[];
  forms: { id: string; name: string; kind: string }[];
  ai: { server: boolean; project: boolean };
  role: { editor: boolean; admin: boolean };
}) {
  const [tab, setTab] = useState("voc");
  const [range, setRange] = useState<Range>(() => presetRange(365));
  const [tag, setTag] = useState("");
  const [ai, setAi] = useState(initialAi);
  const [error, setError] = useState<string | null>(null);
  const [reportsVersion, setReportsVersion] = useState(0);
  const aiOn = ai.server && ai.project;
  const canAi = aiOn && role.editor;

  async function setProjectAi(enabled: boolean) {
    setError(null);
    try {
      await api(`/api/admin/projects/${projectId}/ai`, { method: "PUT", json: { enabled } });
      setAi((a) => ({ ...a, project: enabled }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Saving asks for a name first (a small dialog), then keeps the report as it's shown.
  const [saving, setSaving] = useState<{ s: Saved; name: string; error: string | null } | null>(null);
  function save(s: Saved, fallbackName: string) {
    setSaving({ s, name: fallbackName.slice(0, 120), error: null });
  }
  async function confirmSave(e: React.FormEvent) {
    e.preventDefault();
    if (!saving?.name.trim()) return;
    try {
      await api(`/api/admin/projects/${projectId}/insight-reports`, { method: "POST", json: { kind: saving.s.kind, name: saving.name.trim(), params: saving.s.params, result: saving.s.result } });
      setSaving(null);
      setReportsVersion((v) => v + 1);
    } catch (err) {
      setSaving((x) => (x ? { ...x, error: errorMessage(err) } : x));
    }
  }

  const filters = (
    <div className="in-filters" data-testid="insights-filters">
      <RangePicker value={range} onChange={setRange} testId="insights-range" />
      {tags.length > 0 && (
        <label>
          Tag
          <select value={tag} onChange={(e) => setTag(e.target.value)} data-testid="insights-tag">
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );

  return (
    <div className="stack-lg">
      <section className="panel panel-body stack" aria-label="AI" data-testid="insights-ai">
        {!ai.server ? (
          <p className="muted small" data-testid="insights-ai-off">
            AI is off on this server. Everything here works without it: words and phrases are counted from your testimonials, and questions find the
            testimonials that answer them.{" "}
            <a href={AI_HELP_URL} target="_blank" rel="noopener">
              Add your own AI provider
            </a>{" "}
            for themes, written answers and AI surveys.
          </p>
        ) : (
          <>
            <p className="muted small">
              {ai.project
                ? "AI is on for this project. Only what you ask about is sent to your AI provider (testimonials' words and ratings, never names, emails or private fields), and only when you press a button that says so."
                : "AI is off for this project: nothing of it is sent to the AI provider. Words and phrases are still counted without it."}
            </p>
            {role.admin && <Toggle label="AI in this project" checked={ai.project} onChange={(v) => void setProjectAi(v)} testId="insights-ai-toggle" />}
          </>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </section>
      <Tabs
        label="Insights"
        tabs={[
          { id: "voc", label: "Voice of Customer" },
          { id: "ask", label: "Ask a question" },
          { id: "nps", label: "NPS" },
          { id: "reports", label: "Saved reports" },
        ]}
        value={tab}
        onChange={setTab}
        testId="insights-tabs"
      >
        {tab === "voc" && <VocTab projectId={projectId} range={range} tag={tag} filters={filters} canAi={canAi} canSave={role.editor} onSave={save} />}
        {tab === "ask" && <AskTab projectId={projectId} range={range} tag={tag} filters={filters} aiOn={aiOn} canSave={role.editor} onSave={save} />}
        {tab === "nps" && <NpsTab projectId={projectId} range={range} forms={forms} canAi={canAi} canSave={role.editor} onSave={save} rangePicker={<RangePicker value={range} onChange={setRange} testId="nps-range" />} />}
        {tab === "reports" && <ReportsTab projectId={projectId} version={reportsVersion} canEdit={role.editor} />}
      </Tabs>
      <Modal
        open={saving !== null}
        onClose={() => setSaving(null)}
        title="Save this report"
        description="It's kept as it is now, for your team, and can be downloaded as CSV."
        size="sm"
        testId="report-save-dialog"
        onSubmit={confirmSave}
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setSaving(null)}>
              Cancel
            </button>
            <button type="submit" disabled={!saving?.name.trim()} data-testid="report-save-confirm">
              Save report
            </button>
          </>
        }
      >
        <label>
          Name
          <input type="text" value={saving?.name ?? ""} onChange={(e) => setSaving((x) => (x ? { ...x, name: e.target.value } : x))} maxLength={120} data-autofocus data-testid="report-name" />
        </label>
        {saving?.error && (
          <p className="error small" role="alert">
            {saving.error}
          </p>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ Voice of Customer

function Phrases({ items, label, testId, empty }: { items: Counted[]; label: string; testId: string; empty: string }) {
  if (!items.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="in-phrases" aria-label={label} data-testid={testId}>
      {items.map((k) => (
        <li key={k.label}>
          {k.label}
          <span className="n">
            {k.count}
            <span className="visually-hidden"> testimonials</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Cites({ ids, cited }: { ids: string[]; cited: VocReport["cited"] }) {
  const list = ids.map((id) => [id, cited[id]] as const).filter(([, c]) => c);
  if (!list.length) return null;
  return (
    <ol className="in-cites" aria-label="From these">
      {list.slice(0, 5).map(([id, c]) => (
        <li key={id}>
          <strong>{c!.name}</strong>
          {c!.rating != null ? ` (${c!.rating})` : ""}: {c!.excerpt}
        </li>
      ))}
    </ol>
  );
}

export function VocView({ report }: { report: VocReport }) {
  const b = report.breakdown;
  const survey = report.filters.source === "survey";
  return (
    <div className="stack-lg" data-testid="voc-report">
      <div className="in-grid">
        <Tile label={survey ? "Survey comments" : "Testimonials"} value={fmt(b.count)} testId="voc-count" sub={report.truncated ? "The newest 2,000" : undefined} />
        <Tile label={survey ? "Average score" : "Average rating"} value={b.average ?? "–"} sub={`${fmt(b.rated)} rated`} testId="voc-average" />
        <Tile
          label="Sentiment"
          value={`${fmt(b.sentiment.positive)} positive`}
          sub={`${fmt(b.sentiment.neutral)} neutral · ${fmt(b.sentiment.negative)} negative${b.sentiment.unrated ? ` · ${fmt(b.sentiment.unrated)} unrated` : ""}`}
          testId="voc-sentiment"
        />
      </div>
      {b.rated > 0 && (
        <div>
          <h3>{survey ? "Scores" : "Ratings"}</h3>
          <BarList items={[...b.ratings].reverse().map((r) => ({ key: String(r.value), label: survey ? `${r.value}` : `${r.value} ★`, value: r.count }))} label={survey ? "Answers per score" : "Testimonials per rating"} testId="voc-ratings" />
        </div>
      )}
      {report.themes && (
        <section className="stack" data-testid="voc-themes" aria-labelledby="voc-themes-h">
          <h3 id="voc-themes-h">Themes (AI, from {report.themes.sampled} of them)</h3>
          {report.themes.summary && <p>{report.themes.summary}</p>}
          <ul className="in-themes">
            {report.themes.themes.map((t) => (
              <li key={t.name}>
                <strong>{t.name}</strong>{" "}
                <span className="in-sentiment small" data-s={t.sentiment}>
                  {t.sentiment}
                </span>
                {t.summary && <p className="small" style={{ margin: "4px 0 0" }}>{t.summary}</p>}
                <Cites ids={t.ids} cited={report.cited} />
              </li>
            ))}
          </ul>
          <div className="in-grid">
            <div>
              <h4>What they love</h4>
              <ul className="in-themes">
                {report.themes.love.map((t) => (
                  <li key={t.point}>
                    {t.point}
                    <Cites ids={t.ids} cited={report.cited} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>What to improve</h4>
              <ul className="in-themes">
                {report.themes.improve.map((t) => (
                  <li key={t.point}>
                    {t.point}
                    <Cites ids={t.ids} cited={report.cited} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
      <section className="stack" aria-labelledby="voc-words-h">
        <h3 id="voc-words-h">What they talk about</h3>
        <Phrases items={report.keywords.phrases} label="Phrases" testId="voc-phrases" empty="Not enough words yet to find phrases they share." />
        <Phrases items={report.keywords.words} label="Words" testId="voc-words" empty="" />
      </section>
      <div className="in-grid">
        <section className="stack" aria-labelledby="voc-love-h">
          <h3 id="voc-love-h">What they love</h3>
          <p className="muted small">Phrases from the {survey ? "promoters (9–10)" : "4- and 5-star ones"}.</p>
          <Phrases items={report.keywords.love} label="What they love" testId="voc-love" empty="None in this range." />
        </section>
        <section className="stack" aria-labelledby="voc-improve-h">
          <h3 id="voc-improve-h">What to improve</h3>
          <p className="muted small">Phrases from the {survey ? "passives and detractors (0–8)" : "ones with 3 stars or fewer"}.</p>
          <Phrases items={report.keywords.improve} label="What to improve" testId="voc-improve" empty="None in this range." />
        </section>
      </div>
    </div>
  );
}

function VocTab({
  projectId,
  range,
  tag,
  filters,
  canAi,
  canSave,
  onSave,
}: {
  projectId: string;
  range: Range;
  tag: string;
  filters: React.ReactNode;
  canAi: boolean;
  canSave: boolean;
  onSave: (s: Saved, name: string) => void;
}) {
  const [source, setSource] = useState<Source>("testimonials");
  const [report, setReport] = useState<VocReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = { from: range.from, to: range.to, tags: tag ? [tag] : [], source };

  const load = useCallback(async () => {
    setError(null);
    try {
      setReport((await api<{ report: VocReport }>(`/api/admin/projects/${projectId}/insights?${qs({ from: range.from, to: range.to, tags: tag || undefined, source })}`)).report);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [projectId, range.from, range.to, tag, source]);
  useEffect(() => {
    void load();
  }, [load]);

  async function themes() {
    setBusy(true);
    setError(null);
    try {
      setReport((await api<{ report: VocReport }>(`/api/admin/projects/${projectId}/insights/themes`, { method: "POST", json: params })).report);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-4)" }}>
      <div className="in-filters">
        {filters}
        <label>
          From
          <select value={source} onChange={(e) => setSource(e.target.value as Source)} data-testid="voc-source">
            <option value="testimonials">Testimonials</option>
            <option value="survey">Survey comments (NPS)</option>
          </select>
        </label>
      </div>
      <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
        {canAi && (
          <button type="button" className="secondary small" onClick={() => void themes()} disabled={busy || !report?.breakdown.count} data-testid="voc-ai">
            <Icon name="sparkle" />
            {busy ? "Reading…" : "Find themes with AI"}
          </button>
        )}
        {canSave && report && (
          <button type="button" className="ghost small" onClick={() => onSave({ kind: "voc", params, result: report }, `Voice of Customer ${range.from} to ${range.to}`)} data-testid="voc-save">
            Save report
          </button>
        )}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {report ? (
        report.breakdown.count ? (
          <VocView report={report} />
        ) : (
          <EmptyState icon="chart" title="Nothing in this range" level={3} testId="voc-empty">
            Choose a longer period or another tag.
          </EmptyState>
        )
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Ask a question

export function AskView({ result }: { result: AskResult }) {
  return (
    <div className="stack" data-testid="ask-result">
      {result.answer && (
        <div className="panel panel-body" data-testid="ask-answer">
          <p style={{ margin: 0 }}>{result.answer}</p>
        </div>
      )}
      {result.note && (
        <p className="muted small" data-testid="ask-note">
          {result.note}
        </p>
      )}
      {result.matches.length > 0 && (
        <>
          <p className="muted small">
            {result.matches.length} {result.matches.length === 1 ? "testimonial" : "testimonials"}, found by {result.method === "smart-search" ? "smart search" : "keywords"}
            {result.cited.length ? `; the answer cites ${result.cited.length}` : ""}.
          </p>
          <ol className="in-themes" data-testid="ask-matches">
            {result.matches.map((m) => (
              <li key={m.id} data-cited={result.cited.includes(m.id) || undefined}>
                <strong>{[m.name, m.company].filter(Boolean).join(", ")}</strong>
                <span className="muted small">
                  {" "}
                  · {m.date}
                  {m.rating != null ? ` · ${m.rating} ★` : ""}
                  {result.cited.includes(m.id) ? " · cited" : ""}
                </span>
                <p className="small" style={{ margin: "4px 0 0" }}>
                  {m.excerpt}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function AskTab({
  projectId,
  range,
  tag,
  filters,
  aiOn,
  canSave,
  onSave,
}: {
  projectId: string;
  range: Range;
  tag: string;
  filters: React.ReactNode;
  aiOn: boolean;
  canSave: boolean;
  onSave: (s: Saved, name: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult((await api<{ result: AskResult }>(`/api/admin/projects/${projectId}/insights/ask`, { method: "POST", json: { question, from: range.from, to: range.to, tags: tag ? [tag] : [] } })).result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-4)" }}>
      {filters}
      <form className="stack" onSubmit={ask}>
        <label>
          Your question
          <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="What do customers say about onboarding?" data-testid="ask-question" />
        </label>
        <p className="muted small">
          {aiOn
            ? "Finds the testimonials that answer it, then your AI provider writes a short answer that cites them (only those testimonials' words are sent)."
            : "Finds the testimonials that answer it. With AI on, a short written answer citing them appears too."}
        </p>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          <button type="submit" disabled={busy || !question.trim()} data-testid="ask-submit">
            {busy ? "Looking…" : "Ask"}
          </button>
          {canSave && result && (
            <button type="button" className="ghost small" onClick={() => onSave({ kind: "ask", params: { question: result.question, from: range.from, to: range.to, tags: tag ? [tag] : [] }, result }, result.question.slice(0, 120))} data-testid="ask-save">
              Save report
            </button>
          )}
        </div>
      </form>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {result && <AskView result={result} />}
    </div>
  );
}

// ------------------------------------------------------------------ NPS

export function NpsView({ summary }: { summary: NpsSummary }) {
  return (
    <div className="stack-lg" data-testid="nps-report">
      <div className="in-grid">
        <Tile label="NPS" value={<span className="in-nps-score">{summary.score ?? "–"}</span>} sub={`${fmt(summary.responses)} ${summary.responses === 1 ? "answer" : "answers"}`} testId="nps-score" />
        <Tile label="Promoters (9–10)" value={fmt(summary.promoters)} testId="nps-promoters" />
        <Tile label="Passives (7–8)" value={fmt(summary.passives)} testId="nps-passives" />
        <Tile label="Detractors (0–6)" value={fmt(summary.detractors)} testId="nps-detractors" />
      </div>
      {summary.responses > 0 && (
        <div className="in-grid">
          <div>
            <h3>Scores</h3>
            <BarList items={[...summary.distribution].reverse().map((d) => ({ key: String(d.value), label: String(d.value), value: d.count }))} label="Answers per score" testId="nps-distribution" />
          </div>
          <div>
            <h3>Trend, per {summary.trend.by}</h3>
            <table className="data-table small" data-testid="nps-trend">
              <thead>
                <tr>
                  <th scope="col">{summary.trend.by === "week" ? "Week of" : "Day"}</th>
                  <th scope="col">Answers</th>
                  <th scope="col">NPS</th>
                </tr>
              </thead>
              <tbody>
                {summary.trend.points.map((p) => (
                  <tr key={p.period}>
                    <td>{p.period}</td>
                    <td>{p.responses}</td>
                    <td>{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <section className="stack" aria-labelledby="nps-comments-h">
        <h3 id="nps-comments-h">Comments</h3>
        {summary.comments.length ? (
          <ul className="in-comments" data-testid="nps-comments">
            {summary.comments.map((c) => (
              <li key={c.id}>
                <span className="in-score-chip" data-group={c.group} aria-label={`Score ${c.score}`}>
                  {c.score}
                </span>
                <span>
                  {c.comment}
                  <span className="muted small" style={{ display: "block" }}>
                    {[c.name, c.form, c.date].filter(Boolean).join(" · ")}
                    {c.testimonialId ? " · also sent a testimonial" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No comments in this range.</p>
        )}
      </section>
    </div>
  );
}

function NpsTab({
  projectId,
  range,
  forms,
  canAi,
  canSave,
  onSave,
  rangePicker,
}: {
  projectId: string;
  range: Range;
  forms: { id: string; name: string; kind: string }[];
  canAi: boolean;
  canSave: boolean;
  onSave: (s: Saved, name: string) => void;
  rangePicker: React.ReactNode;
}) {
  const [formId, setFormId] = useState("");
  const [summary, setSummary] = useState<NpsSummary | null>(null);
  const [themes, setThemes] = useState<VocReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setThemes(null);
    try {
      setSummary((await api<{ summary: NpsSummary }>(`/api/admin/projects/${projectId}/nps?${qs({ from: range.from, to: range.to, formId: formId || undefined })}`)).summary);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [projectId, range.from, range.to, formId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function aiThemes() {
    setBusy(true);
    setError(null);
    try {
      setThemes((await api<{ report: VocReport }>(`/api/admin/projects/${projectId}/insights/themes`, { method: "POST", json: { from: range.from, to: range.to, source: "survey", formId: formId || undefined } })).report);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-4)" }}>
      <div className="in-filters">
        {rangePicker}
        <label>
          Form
          <select value={formId} onChange={(e) => setFormId(e.target.value)} data-testid="nps-form">
            <option value="">All forms</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.kind === "survey" ? " (survey)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
        {canAi && summary && summary.comments.length > 0 && (
          <button type="button" className="secondary small" onClick={() => void aiThemes()} disabled={busy} data-testid="nps-ai">
            <Icon name="sparkle" />
            {busy ? "Reading…" : "Find themes in the comments with AI"}
          </button>
        )}
        {canSave && summary && (
          <button type="button" className="ghost small" onClick={() => onSave({ kind: "nps", params: { from: range.from, to: range.to, formId: formId || null }, result: summary }, `NPS ${range.from} to ${range.to}`)} data-testid="nps-save">
            Save report
          </button>
        )}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {summary ? (
        summary.responses ? (
          <NpsView summary={summary} />
        ) : (
          <EmptyState icon="chart" title="No NPS answers yet" level={3} testId="nps-empty">
            Add an NPS question to a form, or make a survey in Forms (New survey). Answers show up here.
          </EmptyState>
        )
      ) : (
        <p className="muted">Loading…</p>
      )}
      {themes?.themes && <VocView report={themes} />}
    </div>
  );
}

// ------------------------------------------------------------------ saved reports

function ReportsTab({ projectId, version, canEdit }: { projectId: string; version: number; canEdit: boolean }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [open, setOpen] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReports((await api<{ reports: Report[] }>(`/api/admin/projects/${projectId}/insight-reports`)).reports);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load, version]);

  async function view(r: Report) {
    setError(null);
    try {
      setOpen((await api<{ report: Report }>(`/api/admin/insight-reports/${r.id}`)).report);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const [removing, setRemoving] = useState<Report | null>(null);
  async function remove() {
    if (!removing) return;
    await api(`/api/admin/insight-reports/${removing.id}`, { method: "DELETE" });
    if (open?.id === removing.id) setOpen(null);
    await load();
  }

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-4)" }}>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {!reports ? (
        <p className="muted">Loading…</p>
      ) : reports.length ? (
        <ul className="cs-list" data-testid="reports-list">
          {reports.map((r) => (
            <li key={r.id}>
              <span className="stack" style={{ gap: 2 }}>
                <strong>{r.name}</strong>
                <span className="muted small">
                  {r.kind === "voc" ? "Voice of Customer" : r.kind === "ask" ? "Question" : "NPS"} · {new Date(r.createdAt).toLocaleDateString("en-GB")}
                  {r.createdBy ? ` · ${r.createdBy}` : ""}
                </span>
              </span>
              <span className="row" style={{ gap: "var(--space-2)" }}>
                <button type="button" className="ghost small" onClick={() => void view(r)} data-testid="report-view">
                  View
                </button>
                {canEdit && (
                  <>
                    <a className="button ghost small" href={`/api/admin/insight-reports/${r.id}/csv`} data-testid="report-csv">
                      <Icon name="download" />
                      CSV
                    </a>
                    <button type="button" className="ghost small" onClick={() => setRemoving(r)} aria-label={`Delete ${r.name}`}>
                      <Icon name="trash" />
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="chart" title="No saved reports" level={3} testId="reports-empty">
          Save a Voice of Customer, a question or an NPS report to keep it as it is today and download it as CSV.
        </EmptyState>
      )}
      {open?.result && (
        <section className="panel panel-body stack" aria-label={open.name} data-testid="report-open">
          <h3>{open.name}</h3>
          {open.kind === "voc" && <VocView report={open.result as unknown as VocReport} />}
          {open.kind === "ask" && <AskView result={open.result as unknown as AskResult} />}
          {open.kind === "nps" && <NpsView summary={open.result as unknown as NpsSummary} />}
        </section>
      )}
      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={remove} title={`Delete “${removing?.name ?? ""}”?`} confirmLabel="Delete" danger>
        The saved report goes; the testimonials it read stay as they are.
      </ConfirmDialog>
    </div>
  );
}
