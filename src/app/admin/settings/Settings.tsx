"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

type Key = {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Hook = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  projectId: string | null;
  formId: string | null;
  active: boolean;
  createdAt: string;
};

type FormOption = { id: string; name: string; projectId: string };

type Delivery = {
  id: string;
  event: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {copied ? "Copied" : label}
    </button>
  );
}

export function Settings({
  apiBase,
  events,
  projects,
  forms = [],
}: {
  apiBase: string;
  events: string[];
  projects: { id: string; name: string }[];
  /** For the webhook editor's "only this form" choice (FORM-10). */
  forms?: FormOption[];
}) {
  return (
    <>
      <ApiKeys apiBase={apiBase} />
      <Webhooks events={events} projects={projects} forms={forms} />
    </>
  );
}

function ApiKeys({ apiBase }: { apiBase: string }) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setKeys((await api<{ keys: Key[] }>("/api/admin/api-keys")).keys);
  }, []);
  useEffect(() => {
    void load().catch((err) => setError(err.message));
  }, [load]);

  return (
    <section className="panel" aria-labelledby="keys-h">
      <div className="panel-head">
        <h2 id="keys-h" style={{ fontSize: "var(--text-base)" }}>
          API keys
        </h2>
      </div>
      <div className="panel-body stack">
        <p className="muted small">
          For scripts and tools such as n8n. Send <code>Authorization: Bearer plk_…</code> to <code>{apiBase}</code>.
          The full reference is at <a href="/api/v1/openapi.json">/api/v1/openapi.json</a> (OpenAPI 3.1).
        </p>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            try {
              const res = await api<{ key: string }>("/api/admin/api-keys", {
                method: "POST",
                body: JSON.stringify({ name: form.get("name"), scope: form.get("scope") }),
              });
              setCreated(res.key);
              (e.target as HTMLFormElement).reset();
              await load();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label style={{ flex: "1 1 200px" }}>
            Key name
            <input type="text" name="name" required maxLength={80} placeholder="n8n on my server" />
          </label>
          <label>
            Access
            <select name="scope" defaultValue="read">
              <option value="read">Read only</option>
              <option value="write">Read and write</option>
            </select>
          </label>
          <button type="submit" style={{ alignSelf: "flex-end" }}>
            Create key
          </button>
        </form>
        {created && (
          <div className="notice" data-testid="new-api-key">
            <p className="small">
              <strong>Copy this key now.</strong> It won&apos;t be shown again.
            </p>
            <div className="row">
              <code className="secret" style={{ flex: 1 }}>
                {created}
              </code>
              <Copy text={created} />
            </div>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {keys.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Access</th>
                  <th>Last used</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} data-testid="api-key-row" data-revoked={Boolean(k.revokedAt)}>
                    <td>{k.name}</td>
                    <td>
                      <code>{k.prefix}…</code>
                    </td>
                    <td>{k.scope === "write" ? "Read and write" : "Read only"}</td>
                    <td className="muted">{k.revokedAt ? `Revoked ${when(k.revokedAt)}` : when(k.lastUsedAt)}</td>
                    <td>
                      {!k.revokedAt && (
                        <button
                          type="button"
                          className="ghost small"
                          onClick={async () => {
                            if (!confirm(`Revoke "${k.name}"? Anything using it stops working.`)) return;
                            await api(`/api/admin/api-keys/${k.id}`, { method: "DELETE" });
                            await load();
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Webhooks({ events, projects, forms }: { events: string[]; projects: { id: string; name: string }[]; forms: FormOption[] }) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setHooks((await api<{ webhooks: Hook[] }>("/api/admin/webhooks")).webhooks);
  }, []);
  useEffect(() => {
    void load().catch((err) => setError(err.message));
  }, [load]);

  return (
    <section className="panel" aria-labelledby="hooks-h">
      <div className="panel-head">
        <h2 id="hooks-h" style={{ fontSize: "var(--text-base)" }}>
          Webhooks
        </h2>
      </div>
      <div className="panel-body stack">
        <p className="muted small">
          Plaudit POSTs JSON to your URL when something happens. Each request is signed with the endpoint&apos;s secret
          (<code>Plaudit-Signature</code> header) and failed deliveries are retried for about 3 hours. See docs/API.md
          for checking the signature.
        </p>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            try {
              await api("/api/admin/webhooks", {
                method: "POST",
                body: JSON.stringify({
                  url: form.get("url"),
                  events: form.getAll("events"),
                  projectId: form.get("projectId") || null,
                }),
              });
              (e.target as HTMLFormElement).reset();
              await load();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <div className="row">
            <label style={{ flex: "2 1 280px" }}>
              Endpoint URL
              <input type="url" name="url" required placeholder="https://n8n.example.com/webhook/…" />
            </label>
            <label style={{ flex: "1 1 160px" }}>
              Project
              <select name="projectId" defaultValue="">
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="event-grid" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
              Events <span className="hint">(none ticked = the default set; opt-in events must be ticked)</span>
            </legend>
            {events.map((ev) => (
              <label key={ev} className="check small">
                <input type="checkbox" name="events" value={ev} />
                <code>{ev}</code>
              </label>
            ))}
          </fieldset>
          <div>
            <button type="submit">Add webhook</button>
          </div>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {hooks.map((h) => (
          <WebhookRow key={h.id} hook={h} projects={projects} forms={forms} events={events} onChange={load} />
        ))}
      </div>
    </section>
  );
}

function WebhookRow({
  hook,
  projects,
  forms,
  events,
  onChange,
}: {
  hook: Hook;
  projects: { id: string; name: string }[];
  forms: FormOption[];
  events: string[];
  onChange: () => Promise<void>;
}) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [showSecret, setShowSecret] = useState(false);
  const [editing, setEditing] = useState(false);

  const loadDeliveries = useCallback(async () => {
    setDeliveries((await api<{ deliveries: Delivery[] }>(`/api/admin/webhooks/${hook.id}/deliveries`)).deliveries);
  }, [hook.id]);
  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);
  // Watch pending deliveries until they settle.
  const pending = deliveries.some((d) => d.status === "pending");
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => void loadDeliveries(), 1500);
    return () => clearInterval(id);
  }, [pending, loadDeliveries]);

  const project = projects.find((p) => p.id === hook.projectId)?.name ?? "All projects";
  const formName = hook.formId ? (forms.find((f) => f.id === hook.formId)?.name ?? "one form") : null;

  return (
    <article className="card stack" data-testid="webhook" data-active={hook.active}>
      <div className="row spread">
        <div style={{ minWidth: 0 }}>
          <strong style={{ wordBreak: "break-all" }}>{hook.url}</strong>
          <div className="muted xsmall">
            {project}
            {formName && ` · only “${formName}”`} · {hook.events.length ? hook.events.join(", ") : "default events"}
            {!hook.active && " · paused"}
          </div>
        </div>
        <div className="row" style={{ gap: "var(--space-2)" }}>
          <button
            type="button"
            className="secondary small"
            onClick={async () => {
              await api(`/api/admin/webhooks/${hook.id}/test`, { method: "POST" });
              await loadDeliveries();
            }}
          >
            Send test event
          </button>
          <button type="button" className="ghost small" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
            Edit
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={async () => {
              await api(`/api/admin/webhooks/${hook.id}`, { method: "PATCH", body: JSON.stringify({ active: !hook.active }) });
              await onChange();
            }}
          >
            {hook.active ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            className="ghost small"
            aria-label={`Delete webhook ${hook.url}`}
            onClick={async () => {
              if (!confirm("Delete this webhook and its delivery log?")) return;
              await api(`/api/admin/webhooks/${hook.id}`, { method: "DELETE" });
              await onChange();
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      {editing && (
        <WebhookEditor
          hook={hook}
          projects={projects}
          forms={forms}
          events={events}
          onDone={async (saved) => {
            setEditing(false);
            if (saved) await onChange();
          }}
        />
      )}
      <div className="row small">
        <span>Signing secret:</span>
        {showSecret ? (
          <code className="secret" data-testid="webhook-secret">
            {hook.secret}
          </code>
        ) : (
          <button type="button" className="ghost small" onClick={() => setShowSecret(true)}>
            Reveal
          </button>
        )}
        {showSecret && <Copy text={hook.secret} />}
        <button
          type="button"
          className="ghost small"
          onClick={async () => {
            if (!confirm("Replace the secret? Update your receiver to use the new one.")) return;
            await api(`/api/admin/webhooks/${hook.id}`, { method: "PATCH", body: JSON.stringify({ rotateSecret: true }) });
            await onChange();
          }}
        >
          Rotate
        </button>
      </div>
      <details open={deliveries.length > 0}>
        <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>
          Recent deliveries ({deliveries.length})
        </summary>
        {deliveries.length === 0 ? (
          <p className="muted small">Nothing sent yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Result</th>
                  <th>Attempts</th>
                  <th>Sent</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} data-testid="delivery" data-status={d.status}>
                    <td>
                      <code>{d.event}</code>
                    </td>
                    <td className={d.status === "failed" ? "error-text" : undefined}>
                      {d.status === "success"
                        ? `${d.responseStatus} OK${d.durationMs !== null ? ` · ${d.durationMs} ms` : ""}`
                        : d.status === "pending"
                          ? d.error
                            ? `Retrying (${d.error})`
                            : "Sending…"
                          : `Failed: ${d.error}`}
                    </td>
                    <td>{d.attempts}</td>
                    <td className="muted">{new Date(d.createdAt).toLocaleString()}</td>
                    <td>
                      {d.status !== "pending" && (
                        <button
                          type="button"
                          className="ghost small"
                          onClick={async () => {
                            await api(`/api/admin/webhook-deliveries/${d.id}/redeliver`, { method: "POST" });
                            await loadDeliveries();
                          }}
                        >
                          Redeliver
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </article>
  );
}

/** Changes a webhook's URL, events, project and form in place (PRD §19); the secret and the delivery log stay. */
function WebhookEditor({
  hook,
  projects,
  forms,
  events,
  onDone,
}: {
  hook: Hook;
  projects: { id: string; name: string }[];
  forms: FormOption[];
  events: string[];
  onDone: (saved: boolean) => Promise<void>;
}) {
  const [url, setUrl] = useState(hook.url);
  const [projectId, setProjectId] = useState(hook.projectId ?? "");
  const [formId, setFormId] = useState(hook.formId ?? "");
  const [chosen, setChosen] = useState<string[]>(hook.events);
  const [error, setError] = useState<string | null>(null);
  const projectForms = forms.filter((f) => f.projectId === projectId);
  return (
    <form
      className="stack"
      data-testid="webhook-editor"
      style={{ borderTop: "1px solid var(--line)", paddingTop: "var(--space-3)" }}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api(`/api/admin/webhooks/${hook.id}`, {
            method: "PATCH",
            body: JSON.stringify({ url, events: chosen, projectId: projectId || null, formId: projectId && formId ? formId : null }),
          });
          await onDone(true);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div className="row">
        <label style={{ flex: "2 1 260px" }}>
          Endpoint URL
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label style={{ flex: "1 1 160px" }}>
          Project
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setFormId("");
            }}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {projectId && projectForms.length > 0 && (
          <label style={{ flex: "1 1 160px" }}>
            Form
            <select value={formId} onChange={(e) => setFormId(e.target.value)}>
              <option value="">Every form</option>
              {projectForms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <fieldset className="event-grid" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
          Events <span className="hint">(none ticked = the default set)</span>
        </legend>
        {events.map((ev) => (
          <label key={ev} className="check small">
            <input
              type="checkbox"
              checked={chosen.includes(ev)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, ev] : chosen.filter((x) => x !== ev))}
            />
            <code>{ev}</code>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit">Save webhook</button>
        <button type="button" className="ghost" onClick={() => void onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
