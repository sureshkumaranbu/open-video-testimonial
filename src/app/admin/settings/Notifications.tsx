"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/app/admin/api";
import { Toggle } from "@/components/admin";
import { Icon } from "@/components/Icon";
import "@/app/admin/notifications.css";

/**
 * Settings → Notifications (INT-01, INT-02): the signed-in person's own
 * emails, and the team's chat channels (Slack, Discord, Teams, Telegram).
 * Everything starts off (D14).
 */

type Frequency = "instant" | "daily" | "off";
type Prefs = { newTestimonial: Frequency; weeklyPending: boolean; importSummary: boolean; monthlyReport: boolean; widgetRemoved: boolean; projectIds: string[] };
type ChannelType = "slack" | "discord" | "teams" | "telegram";
type Channel = {
  id: string;
  projectId: string | null;
  type: ChannelType;
  name: string;
  target: string;
  events: string[];
  formIds: string[];
  active: boolean;
  lastSentAt: string | null;
  lastError: string | null;
};
type ProjectOption = { id: string; name: string };

const TYPES: { id: ChannelType; label: string; hint: string; placeholder: string }[] = [
  { id: "slack", label: "Slack", hint: "In Slack, add the Incoming Webhooks app to a channel and copy its webhook URL.", placeholder: "https://hooks.slack.com/services/…" },
  { id: "discord", label: "Discord", hint: "In Discord, open the channel's settings → Integrations → Webhooks → New webhook, then Copy webhook URL.", placeholder: "https://discord.com/api/webhooks/…" },
  { id: "teams", label: "Microsoft Teams", hint: "In Teams, add the “Post to a channel when a webhook request is received” workflow and copy its URL.", placeholder: "https://….logic.azure.com/workflows/…" },
  { id: "telegram", label: "Telegram", hint: "Create a bot with @BotFather, add it to your group or channel, then enter its token and the chat id.", placeholder: "" },
];
const EVENTS = [
  { id: "testimonial.created", label: "New testimonials" },
  { id: "testimonial.approved", label: "Approved testimonials" },
];
const typeLabel = (t: ChannelType) => TYPES.find((x) => x.id === t)?.label ?? t;

/** `widgetAlerts`: install detection is on (analytics), so "a widget stopped showing" can be offered. */
export function Notifications({ email, projects, widgetAlerts = true }: { email: string; projects: ProjectOption[]; widgetAlerts?: boolean }) {
  return (
    <section className="panel" aria-labelledby="notify-h" id="notifications">
      <div className="panel-head">
        <h2 id="notify-h" style={{ fontSize: "var(--text-base)" }}>
          Notifications
        </h2>
      </div>
      <div className="panel-body stack-lg">
        <EmailPrefs email={email} projects={projects} widgetAlerts={widgetAlerts} />
        <Channels projects={projects} />
      </div>
    </section>
  );
}

function EmailPrefs({ email, projects, widgetAlerts }: { email: string; projects: ProjectOption[]; widgetAlerts: boolean }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [mode, setMode] = useState<"smtp" | "outbox" | "off">("off");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ notifications: Prefs; emailMode: "smtp" | "outbox" | "off" }>("/api/admin/me/notifications")
      .then((r) => {
        setPrefs(r.notifications);
        setMode(r.emailMode);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (!prefs) return error ? <p className="error" role="alert">{error}</p> : <p className="muted small">Loading…</p>;
  const set = (patch: Partial<Prefs>) => setPrefs({ ...prefs, ...patch });
  const allProjects = prefs.projectIds.length === 0;

  return (
    <form
      className="stack nt-prefs"
      data-testid="notify-prefs"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setStatus("Saving…");
        try {
          const r = await api<{ notifications: Prefs }>("/api/admin/me/notifications", { method: "PUT", json: { notifications: prefs } });
          setPrefs(r.notifications);
          setStatus("Saved");
        } catch (err) {
          setStatus("");
          setError((err as Error).message);
        }
      }}
    >
      <div>
        <h3 className="small nt-h">Your emails</h3>
        <p className="muted xsmall">
          Sent to <strong>{email}</strong>. Each person on the team chooses their own.
        </p>
      </div>
      {mode === "off" && (
        <p className="notice warn small" data-testid="notify-email-off">
          Email isn&apos;t set up on this server yet, so nothing will be sent. Set SMTP_URL (see docs/EMAIL.md).
        </p>
      )}
      <label className="nt-field">
        New testimonials
        <select value={prefs.newTestimonial} onChange={(e) => set({ newTestimonial: e.target.value as Frequency })}>
          <option value="instant">Email me each one as it arrives</option>
          <option value="daily">One email a day (a digest)</option>
          <option value="off">Don&apos;t email me</option>
        </select>
      </label>
      <Toggle label="Weekly reminder of testimonials waiting for review (Mondays)" checked={prefs.weeklyPending} onChange={(weeklyPending) => set({ weeklyPending })} />
      <Toggle label="A summary when an import finishes" checked={prefs.importSummary} onChange={(importSummary) => set({ importSummary })} />
      <Toggle label="A monthly report (on the 1st)" checked={prefs.monthlyReport} onChange={(monthlyReport) => set({ monthlyReport })} />
      {widgetAlerts && (
        <Toggle
          label="When a widget stops showing on your site (no views for 7 days)"
          checked={prefs.widgetRemoved}
          onChange={(widgetRemoved) => set({ widgetRemoved })}
          testId="notify-widget-removed"
        />
      )}
      {projects.length > 1 && (
        <fieldset className="nt-projects">
          <legend className="small">Projects</legend>
          <label className="check small">
            <input type="radio" name="nt-scope" checked={allProjects} onChange={() => set({ projectIds: [] })} />
            All of them
          </label>
          <label className="check small">
            <input type="radio" name="nt-scope" checked={!allProjects} onChange={() => set({ projectIds: [projects[0].id] })} />
            Only these:
          </label>
          {!allProjects && (
            <div className="nt-project-list">
              {projects.map((p) => (
                <label key={p.id} className="check small">
                  <input
                    type="checkbox"
                    checked={prefs.projectIds.includes(p.id)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...prefs.projectIds, p.id] : prefs.projectIds.filter((id) => id !== p.id);
                      set({ projectIds: next.length ? next : [] });
                    }}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      <div className="row">
        <button type="submit">Save email settings</button>
        <span className="muted small" role="status" aria-live="polite">
          {status}
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function TargetFields({ type, required }: { type: ChannelType; required: boolean }) {
  const t = TYPES.find((x) => x.id === type)!;
  if (type === "telegram") {
    return (
      <div className="row">
        <label style={{ flex: "2 1 220px" }}>
          Bot token
          <input type="password" name="botToken" required={required} autoComplete="off" placeholder="123456789:AA…" />
        </label>
        <label style={{ flex: "1 1 140px" }}>
          Chat id
          <input type="text" name="chatId" required={required} placeholder="-1001234567890 or @mychannel" />
        </label>
      </div>
    );
  }
  return (
    <label>
      Webhook URL
      <input type="url" name="url" required={required} placeholder={t.placeholder} autoComplete="off" />
    </label>
  );
}

function targetFrom(type: ChannelType, form: FormData) {
  if (type === "telegram") {
    const botToken = String(form.get("botToken") ?? "").trim();
    const chatId = String(form.get("chatId") ?? "").trim();
    return botToken || chatId ? { botToken, chatId } : undefined;
  }
  const url = String(form.get("url") ?? "").trim();
  return url || undefined;
}

function Channels({ projects }: { projects: ProjectOption[] }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [type, setType] = useState<ChannelType>("slack");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setChannels((await api<{ channels: Channel[] }>("/api/admin/notification-channels")).channels);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [load]);

  const hint = TYPES.find((x) => x.id === type)!.hint;

  return (
    <div className="stack" data-testid="notify-channels">
      <div>
        <h3 className="small nt-h">Chat channels</h3>
        <p className="muted xsmall">
          Post new testimonials (with the stars, the quote and a link to approve it) to a team chat. A form can choose which channels it uses
          in its Settings.
        </p>
      </div>
      <form
        className="stack nt-add"
        onSubmit={async (e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          const form = new FormData(formEl);
          setError(null);
          try {
            await api("/api/admin/notification-channels", {
              method: "POST",
              json: {
                type,
                name: form.get("name"),
                target: targetFrom(type, form) ?? "",
                projectId: form.get("projectId") || null,
                events: form.getAll("events"),
              },
            });
            formEl.reset();
            await load();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="row">
          <label style={{ flex: "1 1 160px" }}>
            Service
            <select value={type} onChange={(e) => setType(e.target.value as ChannelType)}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: "2 1 200px" }}>
            Channel name
            <input type="text" name="name" required maxLength={80} placeholder="#testimonials" />
          </label>
          {/* Not wrapped in its label: the option text would join the label's text. */}
          <div className="nt-select field" style={{ flex: "1 1 160px" }}>
            <label htmlFor="nt-new-project">Posts for</label>
            <select id="nt-new-project" name="projectId" defaultValue="">
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="muted xsmall">{hint}</p>
        <TargetFields type={type} required />
        <fieldset className="nt-events">
          <legend className="small">Post about</legend>
          {EVENTS.map((ev) => (
            <label key={ev.id} className="check small">
              <input type="checkbox" name="events" value={ev.id} defaultChecked={ev.id === "testimonial.created"} />
              {ev.label}
            </label>
          ))}
        </fieldset>
        <div>
          <button type="submit">Add channel</button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {channels.length === 0 ? (
        <p className="muted small" data-testid="notify-channels-empty">
          No chat channels yet.
        </p>
      ) : (
        <ul className="nt-list">
          {channels.map((c) => (
            <ChannelRow key={c.id} channel={c} projects={projects} onChange={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChannelRow({ channel: c, projects, onChange }: { channel: Channel; projects: ProjectOption[]; onChange: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const project = projects.find((p) => p.id === c.projectId)?.name ?? "All projects";
  const events = EVENTS.filter((e) => c.events.includes(e.id)).map((e) => e.label.toLowerCase());

  return (
    <li className="card nt-channel stack" data-testid="notify-channel" data-active={c.active} data-type={c.type}>
      <div className="row spread">
        <div style={{ minWidth: 0 }}>
          <strong>{c.name}</strong> <span className="badge">{typeLabel(c.type)}</span>
          <div className="muted xsmall nt-target">{c.target}</div>
          <div className="muted xsmall">
            {project} · {events.join(", ") || "nothing"}
            {!c.active && " · paused"}
          </div>
          {c.lastError ? (
            <div className="error-text xsmall" data-testid="notify-channel-error">
              Last attempt failed: {c.lastError}
            </div>
          ) : c.lastSentAt ? (
            <div className="muted xsmall">Last sent {new Date(c.lastSentAt).toLocaleString()}</div>
          ) : null}
        </div>
        <div className="row nt-actions">
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setResult(null);
              try {
                await api(`/api/admin/notification-channels/${c.id}/test`, { method: "POST" });
                setResult({ ok: true, text: "Test message sent" });
              } catch (err) {
                setResult({ ok: false, text: (err as Error).message });
              } finally {
                setBusy(false);
                await onChange();
              }
            }}
          >
            {busy ? "Sending…" : "Send test"}
          </button>
          <button type="button" className="ghost small" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            Edit
          </button>
          <button
            type="button"
            className="ghost small"
            onClick={async () => {
              await api(`/api/admin/notification-channels/${c.id}`, { method: "PATCH", json: { active: !c.active } });
              await onChange();
            }}
          >
            {c.active ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            className="ghost small"
            aria-label={`Delete channel ${c.name}`}
            onClick={async () => {
              if (!confirm(`Delete the channel “${c.name}”?`)) return;
              await api(`/api/admin/notification-channels/${c.id}`, { method: "DELETE" });
              await onChange();
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <p className={result?.ok ? "muted small" : "error small"} role="status" aria-live="polite" data-testid="notify-test-result">
        {result?.text ?? ""}
      </p>
      {editing && (
        <form
          className="stack nt-edit"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              const target = targetFrom(c.type, form);
              await api(`/api/admin/notification-channels/${c.id}`, {
                method: "PATCH",
                json: { name: form.get("name"), projectId: form.get("projectId") || null, events: form.getAll("events"), ...(target ? { target } : {}) },
              });
              setEditing(false);
              setResult(null);
              await onChange();
            } catch (err) {
              setResult({ ok: false, text: (err as Error).message });
            }
          }}
        >
          <div className="row">
            <label style={{ flex: "2 1 200px" }}>
              Channel name
              <input type="text" name="name" required maxLength={80} defaultValue={c.name} />
            </label>
            <div className="nt-select field" style={{ flex: "1 1 160px" }}>
              <label htmlFor={`nt-project-${c.id}`}>Posts for</label>
              <select id={`nt-project-${c.id}`} name="projectId" defaultValue={c.projectId ?? ""}>
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <TargetFields type={c.type} required={false} />
          <p className="muted xsmall">Leave the {c.type === "telegram" ? "token and chat id" : "URL"} empty to keep the current one.</p>
          <fieldset className="nt-events">
            <legend className="small">Post about</legend>
            {EVENTS.map((ev) => (
              <label key={ev.id} className="check small">
                <input type="checkbox" name="events" value={ev.id} defaultChecked={c.events.includes(ev.id)} />
                {ev.label}
              </label>
            ))}
          </fieldset>
          <div className="row">
            <button type="submit">Save channel</button>
            <button type="button" className="ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
