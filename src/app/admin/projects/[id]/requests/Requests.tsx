"use client";

import { useCallback, useEffect, useState } from "react";
import type { EmailStatus, Project, RequestStatus } from "@/db/schema";
import { Icon } from "@/components/Icon";

type Row = {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  status: RequestStatus;
  emailStatus: EmailStatus;
  emailError: string | null;
  sentAt: string | null;
  remindersSent: number;
  nextReminderAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  link: string;
};

type Props = {
  project: Project;
  email: { mode: "smtp" | "outbox" | "off"; from: string | null };
  defaults: { subject: string; message: string };
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

const STATUS_LABEL: Record<RequestStatus, string> = {
  waiting: "Waiting",
  responded: "Responded",
  unsubscribed: "Unsubscribed",
};

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";

function emailSummary(r: Row) {
  if (r.emailStatus === "not_sent") return "Link only";
  if (r.emailStatus === "queued") return "Sending…";
  if (r.emailStatus === "failed") return `Failed: ${r.emailError ?? "unknown error"}`;
  const reminders = r.remindersSent ? ` · ${r.remindersSent} reminder${r.remindersSent > 1 ? "s" : ""}` : "";
  const next = r.status === "waiting" && r.nextReminderAt ? ` · next ${date(r.nextReminderAt)}` : "";
  return `Sent ${date(r.sentAt)}${reminders}${next}`;
}

/** Ask people for testimonials: personal links, invitation emails and reminders. */
export function Requests({ project, email, defaults }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [recipients, setRecipients] = useState("");
  const [send, setSend] = useState(email.mode !== "off");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await api<{ requests: Row[] }>(`/api/admin/projects/${project.id}/requests`)).requests);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh while invitations are going out.
  const sending = rows.some((r) => r.emailStatus === "queued");
  useEffect(() => {
    if (!sending) return;
    const id = setInterval(() => void load(), 2000);
    return () => clearInterval(id);
  }, [sending, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ created: Row[]; skipped: { email: string; reason: string }[]; invalid: string[] }>(
        `/api/admin/projects/${project.id}/requests`,
        { method: "POST", body: JSON.stringify({ recipients, send }) },
      );
      const parts = [`Added ${res.created.length} ${res.created.length === 1 ? "person" : "people"}.`];
      if (res.skipped.length) {
        parts.push(`Skipped ${res.skipped.map((s) => `${s.email} (${s.reason === "unsubscribed" ? "unsubscribed" : "already asked"})`).join(", ")}.`);
      }
      if (res.invalid.length) parts.push(`Couldn't read: ${res.invalid.join("; ")}.`);
      setMessage(parts.join(" "));
      setRecipients("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(url: string, method: string) {
    try {
      await api(url, { method });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const counts = {
    waiting: rows.filter((r) => r.status === "waiting").length,
    responded: rows.filter((r) => r.status === "responded").length,
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Requests</h1>
          <p className="muted">
            Send people a personal link. Their name and email are filled in, the testimonial is marked as requested,
            and reminders stop once they respond.
          </p>
        </div>
      </div>

      {email.mode === "off" ? (
        <p className="notice warn" data-testid="email-off">
          Email isn&apos;t set up on this server, so Plaudit can&apos;t send invitations or reminders. You can still
          create personal links and send them yourself. To send email, set <code>SMTP_URL</code> and{" "}
          <code>SMTP_FROM</code> (see the README).
        </p>
      ) : (
        <p className="notice" data-testid="email-on">
          {email.mode === "outbox" ? (
            <>
              Test mode: emails are written to <code>DATA_DIR/mail-outbox</code> instead of being sent.
            </>
          ) : (
            <>Emails are sent from {email.from} through your SMTP server.</>
          )}
        </p>
      )}

      <div className="stat-row">
        <div className="stat pending">
          <strong>{counts.waiting}</strong>
          <span>Waiting for a reply</span>
        </div>
        <div className="stat">
          <strong>{counts.responded}</strong>
          <span>Responded</span>
        </div>
        <div className="stat">
          <strong>{rows.length ? Math.round((counts.responded / rows.length) * 100) : 0}%</strong>
          <span>Response rate</span>
        </div>
      </div>

      <div className="workspace">
        <section className="stack" aria-label="People asked">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {rows.length === 0 ? (
            <div className="empty">
              <Icon name="inbox" />
              <p>Nobody asked yet. Add people on the right.</p>
            </div>
          ) : (
            <div className="table-wrap panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Status</th>
                    <th>Email</th>
                    <th>
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-testid="request-row" data-status={r.status} data-email-status={r.emailStatus}>
                      <td>
                        <strong>{r.name || r.email}</strong>
                        <div className="muted xsmall">{[r.name ? r.email : null, r.company].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td>
                        <span className={`badge ${r.status === "responded" ? "approved" : r.status === "waiting" ? "pending" : ""}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                        {r.respondedAt && <div className="muted xsmall">{date(r.respondedAt)}</div>}
                      </td>
                      <td className={r.emailStatus === "failed" ? "error-text" : "muted"}>{emailSummary(r)}</td>
                      <td>
                        <div className="row" style={{ gap: "var(--space-2)", flexWrap: "nowrap" }}>
                          <CopyLink link={r.link} />
                          {email.mode !== "off" && r.status === "waiting" && (
                            <button type="button" className="ghost small" onClick={() => act(`/api/admin/requests/${r.id}/send`, "POST")}>
                              {r.emailStatus === "not_sent" ? "Send email" : "Send again"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="ghost small"
                            aria-label={`Remove ${r.email}`}
                            onClick={() => confirm(`Remove ${r.email}? Their link will stop working.`) && act(`/api/admin/requests/${r.id}`, "DELETE")}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="stack">
          <form className="panel" onSubmit={create}>
            <div className="panel-head">
              <h2 style={{ fontSize: "var(--text-base)" }}>Ask for testimonials</h2>
            </div>
            <div className="panel-body stack">
              <label>
                <span>
                  People <span className="hint">(one per line: name, email, company; or paste a CSV with a header row)</span>
                </span>
                <textarea
                  rows={6}
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder={"Ada Lovelace, ada@example.com, Engines Ltd\ngrace@example.com"}
                  required
                />
              </label>
              <label className="button secondary small" style={{ flexDirection: "row", alignSelf: "flex-start" }}>
                <Icon name="upload" />
                Load a CSV file
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  data-testid="recipients-file"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setRecipients(await file.text());
                    e.target.value = "";
                  }}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={send}
                  disabled={email.mode === "off"}
                  onChange={(e) => setSend(e.target.checked)}
                />
                Email the invitation now
              </label>
              <div className="row">
                <button type="submit" disabled={busy || !recipients.trim()}>
                  {busy ? "Adding…" : send ? "Add and send" : "Create links"}
                </button>
              </div>
              {message && (
                <p className="muted small" role="status">
                  {message}
                </p>
              )}
            </div>
          </form>
          <EmailSettings project={project} defaults={defaults} />
        </aside>
      </div>
    </div>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function EmailSettings({ project, defaults }: { project: Project; defaults: Props["defaults"] }) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        try {
          await api(`/api/admin/projects/${project.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              inviteSubject: form.get("inviteSubject"),
              inviteMessage: form.get("inviteMessage"),
              reminderDays: form.get("reminderDays"),
              thankYouEmail: form.get("thankYouEmail") === "on",
            }),
          });
          setStatus("Email settings saved");
        } catch (err) {
          setStatus((err as Error).message);
        }
      }}
    >
      <div className="panel-head">
        <h2 style={{ fontSize: "var(--text-base)" }}>Email wording</h2>
      </div>
      <div className="panel-body stack">
        <p className="muted xsmall">
          <code>{"{name}"}</code>, <code>{"{project}"}</code> and <code>{"{link}"}</code> are filled in. Leave a field
          empty to use the default. An unsubscribe line is always added.
        </p>
        <label>
          Subject
          <input type="text" name="inviteSubject" defaultValue={project.inviteSubject} placeholder={defaults.subject} maxLength={200} />
        </label>
        <label>
          Message
          <textarea name="inviteMessage" rows={7} defaultValue={project.inviteMessage} placeholder={defaults.message} maxLength={5000} />
        </label>
        <label>
          <span>
            Reminders <span className="hint">(days after the invitation, e.g. 3, 7; empty for none)</span>
          </span>
          <input type="text" name="reminderDays" defaultValue={project.reminderDays} maxLength={40} />
        </label>
        <label className="check">
          <input type="checkbox" name="thankYouEmail" defaultChecked={project.thankYouEmail} />
          Email people who respond to a request a receipt with their private withdrawal link
        </label>
        <div className="row">
          <button type="submit">Save email settings</button>
          {status && (
            <span className="muted small" role="status">
              {status}
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
