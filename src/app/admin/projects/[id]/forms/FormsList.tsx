"use client";

import "@/app/admin/forms-admin.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/app/admin/api";
import { ConfirmDialog, EmptyState, SearchField, Segmented } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { NewSurvey } from "./NewSurvey";
import type { FormRow } from "./types";

type Props = {
  projectId: string;
  initial: FormRow[];
  templates: { id: string; name: string; description: string }[];
  /** NPS-01 (insights flag): offer "New survey"; `ai` is whether AI is on for the project. */
  surveys?: { ai: boolean };
};

type View = "list" | "expanded";

/** The forms list (FORM-01): search, a list or expanded view, stats, and edit, share, duplicate, pause and delete. */
export function FormsList({ projectId, initial, templates, surveys }: Props) {
  const router = useRouter();
  const [forms, setForms] = useState(initial);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("list");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FormRow | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? forms.filter((f) => `${f.name} ${f.slug}`.toLowerCase().includes(needle)) : forms;
  }, [forms, q]);

  async function reload() {
    setForms((await api<{ forms: FormRow[] }>(`/api/admin/projects/${projectId}/forms`)).forms);
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { form } = await api<{ form: FormRow }>(`/api/admin/projects/${projectId}/forms`, {
        method: "POST",
        json: { name, ...(template ? { template } : {}) },
      });
      router.push(`/admin/projects/${projectId}/forms/${form.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fb-list stack-lg">
      <form className="panel fb-new" onSubmit={create} data-testid="new-form">
        <div className="panel-body row" style={{ flexWrap: "wrap", alignItems: "flex-end", gap: "var(--space-3)" }}>
          <label style={{ flex: "1 1 220px" }}>
            New form name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Customer stories" />
          </label>
          <label style={{ flex: "1 1 220px" }}>
            Start from
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">Blank (your project&apos;s question)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}: {t.description}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="accent" disabled={busy || !name.trim()}>
            <Icon name="plus" />
            {busy ? "Creating…" : "Create form"}
          </button>
        </div>
      </form>
      {surveys && <NewSurvey projectId={projectId} ai={surveys.ai} />}

      <div className="row spread" style={{ flexWrap: "wrap", gap: "var(--space-3)" }}>
        <SearchField label="Search forms" value={q} onChange={setQ} />
        <Segmented<View>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List" },
            { value: "expanded", label: "Expanded" },
          ]}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <EmptyState
          title="No forms match"
          icon="search"
          testId="forms-empty"
          action={
            <button type="button" className="secondary" onClick={() => setQ("")}>
              Clear the search
            </button>
          }
        >
          Try another word, or clear the search.
        </EmptyState>
      ) : (
        <ul className="fb-cards" data-view={view}>
          {shown.map((f) => (
            <li key={f.id} className="card fb-card" data-testid="form-card" data-form={f.slug}>
              <div className="row spread" style={{ gap: "var(--space-3)", flexWrap: "wrap" }}>
                <div className="stack" style={{ gap: 2 }}>
                  <Link href={`/admin/projects/${projectId}/forms/${f.id}`} className="fb-card-name">
                    {f.name}
                  </Link>
                  <span className="muted xsmall">
                    {f.links.hosted.replace(/^https?:\/\//, "")}
                  </span>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {f.isDefault && <span className="badge">Default</span>}
                  {f.kind === "survey" && <span className="badge" data-testid="survey-badge">Survey</span>}
                  <span className="badge" data-status={f.status}>
                    {f.status === "paused" ? "Paused" : "Live"}
                  </span>
                  <span className="badge">{f.layout === "classic" ? "Classic page" : "Step by step"}</span>
                </div>
              </div>
              {f.stats && (
                <dl className="fb-stats">
                  <div>
                    <dt>Submissions</dt>
                    <dd data-testid="stat-submissions">{f.stats.submissions}</dd>
                  </div>
                  <div>
                    <dt>Invites</dt>
                    <dd>{f.stats.invites}</dd>
                  </div>
                  <div>
                    <dt>Response rate</dt>
                    <dd>{f.stats.invites ? `${f.stats.responseRate}%` : "–"}</dd>
                  </div>
                </dl>
              )}
              {view === "expanded" && (
                <p className="muted small">
                  {f.config.pages.filter((p) => p.type === "question" && p.enabled).length} questions · language {f.language}
                  {f.template ? ` · from the ${templates.find((t) => t.id === f.template)?.name ?? f.template} template` : ""}
                </p>
              )}
              <div className="row fb-card-actions" style={{ gap: 6, flexWrap: "wrap" }}>
                <Link className="button secondary small" href={`/admin/projects/${projectId}/forms/${f.id}`}>
                  <Icon name="pen" />
                  Edit
                </Link>
                <Link className="button secondary small" href={`/admin/projects/${projectId}/forms/${f.id}?tab=share`}>
                  <Icon name="link" />
                  Share
                </Link>
                <button type="button" className="secondary small" onClick={() => act(() => api(`/api/admin/forms/${f.id}/duplicate`, { method: "POST" }))}>
                  Duplicate
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    act(() => api(`/api/admin/forms/${f.id}`, { method: "PATCH", json: { status: f.status === "paused" ? "live" : "paused" } }))
                  }
                >
                  {f.status === "paused" ? "Resume" : "Pause"}
                </button>
                {!f.isDefault && (
                  <button type="button" className="danger small" onClick={() => setDeleting(f)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete form"
        danger
        onConfirm={async () => {
          const f = deleting;
          setDeleting(null);
          if (f) await act(() => api(`/api/admin/forms/${f.id}`, { method: "DELETE" }));
        }}
      >
        Its link stops working. Testimonials sent through it stay in your inbox.
      </ConfirmDialog>
    </div>
  );
}
