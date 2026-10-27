"use client";

import "@/app/admin/seo.css";
import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, CopyField, EmptyState, Segmented } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { SCHEMA_TYPE_LABELS, SCOPE_MODES, SEO_SCHEMA_TYPES, type ScopeMode, type SeoSchemaType } from "@/lib/seo";
import type { AdminSnippet } from "@/lib/seo-snippets";

type Props = {
  projectId: string;
  projectName: string;
  origin: string;
  tags: string[];
  forms: { id: string; name: string }[];
  initial: AdminSnippet[];
};

type Draft = {
  name: string;
  schemaType: SeoSchemaType;
  mode: ScopeMode;
  tags: string[];
  formId: string;
  itemName: string;
  url: string;
  description: string;
};

const SCOPE_LABELS: Record<ScopeMode, string> = { all: "All testimonials", tags: "Some tags", form: "One form" };

function draftOf(s: AdminSnippet | null, projectName: string): Draft {
  return {
    name: s?.name ?? "",
    schemaType: s?.schemaType ?? "Product",
    mode: s?.scope.mode ?? "all",
    tags: s?.scope.tags ?? [],
    formId: s?.scope.formId ?? "",
    itemName: s?.item.name ?? projectName,
    url: s?.item.url ?? "",
    description: s?.item.description ?? "",
  };
}

function bodyOf(d: Draft) {
  return {
    name: d.name,
    schemaType: d.schemaType,
    scope: { mode: d.mode, tags: d.tags, formId: d.formId },
    item: { name: d.itemName, url: d.url, description: d.description },
  };
}

/** SEO-01 and SEO-02: saved snippets, each with its two codes, guidance and a result preview. */
export function SnippetsPanel({ projectId, projectName, origin, tags, forms, initial }: Props) {
  const [snippets, setSnippets] = useState(initial);
  const [creating, setCreating] = useState(initial.length === 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminSnippet | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setSnippets((await api<{ snippets: AdminSnippet[] }>(`/api/admin/projects/${projectId}/seo-snippets`)).snippets);
  }

  return (
    <div className="stack-lg">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {creating ? (
        <SnippetForm
          title="New review snippet"
          submitLabel="Create snippet"
          initial={draftOf(null, projectName)}
          tags={tags}
          forms={forms}
          onCancel={snippets.length ? () => setCreating(false) : undefined}
          onSave={async (d) => {
            await api(`/api/admin/projects/${projectId}/seo-snippets`, { method: "POST", json: bodyOf(d) });
            await reload();
            setCreating(false);
          }}
        />
      ) : (
        <div>
          <button type="button" className="accent" onClick={() => setCreating(true)} data-testid="new-snippet">
            <Icon name="plus" />
            New snippet
          </button>
        </div>
      )}

      {snippets.length === 0 && !creating && (
        <EmptyState
          icon="code"
          title="No snippets yet"
          testId="snippets-empty"
          action={
            <button type="button" onClick={() => setCreating(true)}>
              Create a snippet
            </button>
          }
        >
          <p>Create one to add review stars data to a page on your own site.</p>
        </EmptyState>
      )}

      {snippets.map((s) =>
        editing === s.id ? (
          <SnippetForm
            key={s.id}
            title={`Edit “${s.name}”`}
            submitLabel="Save changes"
            initial={draftOf(s, projectName)}
            tags={tags}
            forms={forms}
            onCancel={() => setEditing(null)}
            onSave={async (d) => {
              await api(`/api/admin/seo-snippets/${s.id}`, { method: "PATCH", json: bodyOf(d) });
              await reload();
              setEditing(null);
            }}
          />
        ) : (
          <SnippetCard key={s.id} s={s} origin={origin} forms={forms} onEdit={() => setEditing(s.id)} onDelete={() => setDeleting(s)} />
        ),
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete snippet"
        busyLabel="Deleting…"
        danger
        onConfirm={async () => {
          setError(null);
          try {
            await api(`/api/admin/seo-snippets/${deleting!.id}`, { method: "DELETE" });
            await reload();
          } catch (e) {
            setError(errorMessage(e));
          }
          setDeleting(null);
        }}
      >
        <p>Pages with its script tag stop getting review data. A pasted static copy stays as it is until you remove it.</p>
      </ConfirmDialog>
    </div>
  );
}

function SnippetForm({
  title,
  submitLabel,
  initial,
  tags,
  forms,
  onSave,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  initial: Draft;
  tags: string[];
  forms: { id: string; name: string }[];
  onSave: (d: Draft) => Promise<void>;
  onCancel?: () => void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(d);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} data-testid="snippet-form">
      <div className="panel-body stack">
        <h2 className="seo-title">{title}</h2>
        <div className="seo-grid">
          <label>
            Snippet name
            <input type="text" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required placeholder="Pricing page" />
          </label>
          <label>
            What’s being reviewed
            <select value={d.schemaType} onChange={(e) => set({ schemaType: e.target.value as SeoSchemaType })}>
              {SEO_SCHEMA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SCHEMA_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Its name
            <input type="text" value={d.itemName} onChange={(e) => set({ itemName: e.target.value })} maxLength={120} required />
          </label>
          <label>
            Its page (optional)
            <input type="url" value={d.url} onChange={(e) => set({ url: e.target.value })} maxLength={500} placeholder="https://example.com/pricing" />
          </label>
        </div>
        <label>
          Short description (optional)
          <input type="text" value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} />
        </label>
        <Segmented
          label="Which testimonials"
          options={SCOPE_MODES.map((m) => ({ value: m, label: SCOPE_LABELS[m], disabled: (m === "tags" && !tags.length) || (m === "form" && !forms.length) }))}
          value={d.mode}
          onChange={(mode) => set({ mode })}
          testId="snippet-scope"
        />
        {d.mode === "tags" && (
          <fieldset className="seo-tags">
            <legend>Tags</legend>
            {tags.map((t) => (
              <label key={t} className="checkbox">
                <input
                  type="checkbox"
                  checked={d.tags.includes(t)}
                  onChange={(e) => set({ tags: e.target.checked ? [...d.tags, t] : d.tags.filter((x) => x !== t) })}
                />
                {t}
              </label>
            ))}
          </fieldset>
        )}
        {d.mode === "form" && (
          <label>
            Form
            <select value={d.formId} onChange={(e) => set({ formId: e.target.value })} required>
              <option value="">Choose a form</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="seo-actions">
          <button type="submit" className="accent" disabled={busy || !d.name.trim() || !d.itemName.trim()}>
            {busy ? "Saving…" : submitLabel}
          </button>
          {onCancel && (
            <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function scopeText(s: AdminSnippet, forms: { id: string; name: string }[]) {
  if (s.scope.mode === "tags") return `Tagged ${s.scope.tags.join(", ")}`;
  if (s.scope.mode === "form") return `From “${forms.find((f) => f.id === s.scope.formId)?.name ?? "a deleted form"}”`;
  return "All approved testimonials";
}

function SnippetCard({
  s,
  origin,
  forms,
  onEdit,
  onDelete,
}: {
  s: AdminSnippet;
  origin: string;
  forms: { id: string; name: string }[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"dynamic" | "static">("dynamic");
  return (
    <section className="panel" data-testid="snippet" data-snippet-id={s.id} aria-labelledby={`snip-${s.id}`}>
      <div className="panel-body stack">
        <div className="seo-head">
          <div>
            <h2 className="seo-title" id={`snip-${s.id}`}>
              {s.name}
            </h2>
            <p className="muted">
              {SCHEMA_TYPE_LABELS[s.schemaType]} “{s.item.name}” · {scopeText(s, forms)} ·{" "}
              <span data-testid="snippet-count">
                {s.stats.reviews} {s.stats.reviews === 1 ? "review" : "reviews"}
              </span>
            </p>
          </div>
          <div className="seo-actions">
            <button type="button" className="secondary small" onClick={onEdit}>
              <Icon name="pen" />
              Edit
            </button>
            <button type="button" className="secondary small danger" onClick={onDelete}>
              <Icon name="trash" />
              Delete
            </button>
          </div>
        </div>

        <ul className="seo-guidance" data-testid="snippet-guidance">
          {s.guidance.map((g) => (
            <li key={g.text} data-level={g.level} role={g.level === "warn" ? "note" : undefined}>
              {g.text}
            </li>
          ))}
        </ul>

        <ResultPreview s={s} origin={origin} />

        <Segmented
          label="Snippet type"
          options={[
            { value: "dynamic", label: "Dynamic (stays up to date)" },
            { value: "static", label: "Static (paste once)" },
          ]}
          value={mode}
          onChange={setMode}
          testId="snippet-mode"
        />
        {mode === "dynamic" ? (
          <CopyField
            label="Script tag"
            value={s.codes.dynamic}
            testId="snippet-dynamic"
            hint="Paste it into the page’s HTML. It adds the latest reviews whenever the page loads."
          />
        ) : (
          <CopyField
            label="JSON-LD block"
            value={s.codes.static}
            multiline
            rows={10}
            testId="snippet-static"
            hint="The reviews as they are now. Paste it again after you approve new ones."
          />
        )}
      </div>
    </section>
  );
}

/** SEO-02: roughly how a search result with review stars could look. Illustrative only. */
function ResultPreview({ s, origin }: { s: AdminSnippet; origin: string }) {
  const url = s.item.url || origin;
  let host = url;
  try {
    const u = new URL(url);
    host = `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    /* keep it as typed */
  }
  const avg = s.stats.average;
  return (
    <figure className="seo-result" data-testid="snippet-preview">
      <figcaption className="muted">Example search result (the search engine decides what it shows)</figcaption>
      <div className="seo-result-url">{host}</div>
      <div className="seo-result-title">{s.item.name}</div>
      {avg != null && s.stats.rated > 0 ? (
        <div className="seo-result-stars">
          <span aria-hidden>{"★".repeat(Math.round(avg)).padEnd(5, "☆")}</span> Rating: {avg.toFixed(1)} · {s.stats.rated}{" "}
          {s.stats.rated === 1 ? "review" : "reviews"}
        </div>
      ) : (
        <div className="seo-result-stars muted">No star ratings yet</div>
      )}
      <div className="seo-result-text">{s.item.description || `What people say about ${s.item.name}.`}</div>
    </figure>
  );
}
