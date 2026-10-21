"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project, TestimonialStatus } from "@/db/schema";
import { Avatar, Stars } from "@/components/TestimonialCard";

type AdminTestimonial = {
  id: string;
  status: TestimonialStatus;
  rating: number | null;
  text: string | null;
  authorName: string;
  authorEmail: string | null;
  authorTitle: string | null;
  authorCompany: string | null;
  avatarKey: string | null;
  videoKey: string | null;
  videoMime: string | null;
  createdAt: string;
  tags: string[];
};

type Filter = TestimonialStatus | "all";
const FILTERS: Filter[] = ["pending", "approved", "rejected", "all"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

export function Dashboard({ project: initial, publicUrl }: { project: Project; publicUrl: string }) {
  const [project, setProject] = useState(initial);
  const [filter, setFilter] = useState<Filter>("pending");
  const [items, setItems] = useState<AdminTestimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const data = await api<{ testimonials: AdminTestimonial[] }>(
        `/api/admin/projects/${project.id}${qs}`,
      );
      setItems(data.testimonials);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(id: string, patch: Record<string, unknown>) {
    try {
      await api(`/api/admin/testimonials/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this testimonial and its media permanently?")) return;
    try {
      await api(`/api/admin/testimonials/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>{project.name}</h1>
        <div className="row small">
          <a href={`/c/${project.slug}`} target="_blank" rel="noreferrer">
            Collection page ↗
          </a>
          <a href={`/wall/${project.slug}`} target="_blank" rel="noreferrer">
            Wall of love ↗
          </a>
        </div>
      </div>

      <section className="stack">
        <div className="tabs" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        {loading && items.length === 0 ? <p className="muted">Loading…</p> : null}
        {!loading && items.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
        {items.map((t) => (
          <TestimonialRow
            key={t.id}
            t={t}
            onUpdate={(patch) => update(t.id, patch)}
            onDelete={() => remove(t.id)}
          />
        ))}
      </section>

      <EmbedPanel slug={project.slug} publicUrl={publicUrl} />
      <SettingsPanel project={project} onSaved={setProject} />
    </div>
  );
}

function TestimonialRow({
  t,
  onUpdate,
  onDelete,
}: {
  t: AdminTestimonial;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(t.authorName);
  const [tags, setTags] = useState(t.tags.join(", "));
  const avatarUrl = t.avatarKey ? `/api/media/${t.avatarKey}` : null;
  const dirty = name.trim() !== t.authorName || tags !== t.tags.join(", ");

  return (
    <article className="card stack" data-testid="admin-testimonial" data-status={t.status}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="author row">
          <Avatar name={t.authorName} url={avatarUrl} />
          <div>
            <strong>{t.authorName}</strong>
            <div className="muted small">
              {[t.authorTitle, t.authorCompany].filter(Boolean).join(", ")}
              {t.authorEmail ? ` · ${t.authorEmail}` : ""}
            </div>
          </div>
        </div>
        <div className="row small">
          <span className={`badge ${t.status}`}>{t.status}</span>
          <span className="muted">{new Date(t.createdAt).toLocaleString()}</span>
        </div>
      </div>
      {t.videoKey && (
        <video controls preload="metadata" playsInline style={{ maxWidth: 480 }}>
          <source src={`/api/media/${t.videoKey}`} type={t.videoMime ?? undefined} />
        </video>
      )}
      {t.rating ? <Stars rating={t.rating} /> : null}
      {t.text && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.text}</p>}

      <div className="row" style={{ alignItems: "flex-end" }}>
        <label style={{ flex: 1, minWidth: 160 }}>
          <span className="small">Display name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={{ flex: 2, minWidth: 200 }}>
          <span className="small">Tags (comma separated)</span>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="homepage, pricing"
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={!dirty || !name.trim()}
          onClick={() =>
            onUpdate({
              authorName: name.trim(),
              tags: tags
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        >
          Save
        </button>
      </div>

      <div className="row">
        {t.status !== "approved" && (
          <button type="button" onClick={() => onUpdate({ status: "approved" })}>
            Approve
          </button>
        )}
        {t.status !== "rejected" && (
          <button type="button" className="secondary" onClick={() => onUpdate({ status: "rejected" })}>
            Reject
          </button>
        )}
        {t.status !== "pending" && (
          <button type="button" className="secondary" onClick={() => onUpdate({ status: "pending" })}>
            Move to pending
          </button>
        )}
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </article>
  );
}

function EmbedPanel({ slug, publicUrl }: { slug: string; publicUrl: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const script = `<script src="${publicUrl}/widget.js" data-project="${slug}" data-theme="${theme}" async></script>`;
  const iframe = `<iframe src="${publicUrl}/embed/${slug}?theme=${theme}" title="Testimonials" loading="lazy" style="width:100%;border:0;height:400px" id="plaudit-${slug}"></iframe>
<script>addEventListener("message",function(e){if(e.data&&e.data.type==="plaudit:resize"&&e.data.slug==="${slug}"){document.getElementById("plaudit-${slug}").style.height=e.data.height+"px"}})</script>`;
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Share &amp; embed</h2>
      <p className="small" style={{ margin: 0 }}>
        Collection link: <code>{`${publicUrl}/c/${slug}`}</code>
      </p>
      <div className="tabs" role="group" aria-label="Widget theme">
        {(["light", "dark"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
            {t === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
      <div>
        <strong className="small">Script embed (recommended)</strong>
        <pre data-testid="script-snippet">{script}</pre>
        <p className="muted small" style={{ margin: 0 }}>
          Optional attributes: <code>data-tag</code>, <code>data-limit</code>,{" "}
          <code>data-layout=&quot;grid|list&quot;</code>, <code>data-theme=&quot;auto&quot;</code>.
        </p>
      </div>
      <div>
        <strong className="small">Iframe embed</strong>
        <pre data-testid="iframe-snippet">{iframe}</pre>
      </div>
    </section>
  );
}

function SettingsPanel({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const { project: saved } = await api<{ project: Project }>(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.get("name"),
          prompt: form.get("prompt"),
          thankYouMessage: form.get("thankYouMessage"),
          accentColor: form.get("accentColor"),
          allowText: form.get("allowText") === "on",
          allowVideo: form.get("allowVideo") === "on",
        }),
      });
      onSaved(saved);
      setMessage("Saved");
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2 style={{ margin: 0 }}>Collection page settings</h2>
      <label>
        Project name
        <input type="text" name="name" defaultValue={project.name} required />
      </label>
      <label>
        Question shown to customers
        <input type="text" name="prompt" defaultValue={project.prompt} required />
      </label>
      <label>
        Thank-you message
        <input type="text" name="thankYouMessage" defaultValue={project.thankYouMessage} required />
      </label>
      <label style={{ maxWidth: 160 }}>
        Accent colour
        <input type="color" name="accentColor" defaultValue={project.accentColor} />
      </label>
      <label className="checkbox">
        <input type="checkbox" name="allowText" defaultChecked={project.allowText} /> Allow written
        testimonials
      </label>
      <label className="checkbox">
        <input type="checkbox" name="allowVideo" defaultChecked={project.allowVideo} /> Allow video
        testimonials
      </label>
      <div className="row">
        <button type="submit">Save settings</button>
        {message && <span className="muted small">{message}</span>}
      </div>
    </form>
  );
}
