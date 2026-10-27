"use client";

import { useMemo, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, copyText, EmptyState, Segmented } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { AdminCampaign, AdminRecipient, Skipped } from "@/lib/campaigns";
import { STAGE_LABEL } from "../labels";
import type { Customer } from "./CampaignView";

type Props = {
  campaign: AdminCampaign;
  recipients: AdminRecipient[];
  customers: Customer[];
  emailOn: boolean;
  onChange: () => Promise<void>;
  onError: (message: string | null) => void;
};

type Source = "paste" | "customers" | "manual";
type Report = { added: number; rows: number; skipped: Skipped[] };

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

const REASON_LABEL: Record<Skipped["reason"], string> = {
  invalid: "Not a valid address",
  duplicate: "Already in this campaign",
  unsubscribed: "Unsubscribed",
  responded: "Already responded",
};

/** What happened to their email, in words: the reason when it failed, the date when it's scheduled. */
function emailSummary(r: AdminRecipient, c: AdminCampaign) {
  if (r.emailStatus === "not_sent") {
    if (r.status !== "waiting") return "Not sent";
    return c.status === "draft" ? "Not sent yet: the campaign is a draft" : c.status === "paused" ? "Waiting: the campaign is paused" : "Not sent";
  }
  if (r.emailStatus === "queued") {
    if (r.scheduledFor && new Date(r.scheduledFor).getTime() > Date.now() + 60_000) return `Scheduled for ${date(r.scheduledFor)}`;
    return r.emailError ? `Retrying: ${r.emailError}` : "Sending…";
  }
  if (r.emailStatus === "bounced") return `Bounced: ${r.emailError ?? "the address was refused"}`;
  if (r.emailStatus === "failed") return `Failed: ${r.emailError ?? "unknown error"}`;
  const reminders = r.remindersSent ? ` · ${r.remindersSent} reminder${r.remindersSent > 1 ? "s" : ""}` : "";
  const next = r.status === "waiting" && r.nextReminderAt ? ` · next ${date(r.nextReminderAt)}` : "";
  return `Sent ${date(r.sentAt)}${reminders}${next}`;
}

function trail(r: AdminRecipient) {
  return [
    r.openedAt && `Opened ${date(r.openedAt)}`,
    r.clickedAt && `Clicked ${date(r.clickedAt)}`,
    r.startedAt && `Started ${date(r.startedAt)}`,
    r.respondedAt && `Responded ${date(r.respondedAt)}`,
    r.declinedAt && `Said no thanks ${date(r.declinedAt)}`,
    r.unsubscribedAt && `Unsubscribed ${date(r.unsubscribedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** REQ-02 and REQ-04: add people four ways, see each person's step, and the import report. */
export function RecipientsPanel({ campaign: c, recipients, customers, emailOn, onChange, onError }: Props) {
  const [source, setSource] = useState<Source>("paste");
  const [text, setText] = useState("");
  const [person, setPerson] = useState({ name: "", email: "", company: "", title: "" });
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [removing, setRemoving] = useState<AdminRecipient | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const inCampaign = useMemo(() => new Set(recipients.map((r) => r.email)), [recipients]);
  const shown = customers.filter((p) => `${p.name} ${p.email} ${p.company ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    setReport(null);
    try {
      const json =
        source === "paste" ? { source, text } : source === "customers" ? { source, ids: picked } : { source, person: Object.fromEntries(Object.entries(person).filter(([, v]) => v.trim())) };
      const res = await api<{ added: AdminRecipient[]; skipped: Skipped[]; rows: number }>(`/api/admin/campaigns/${c.id}/recipients`, { method: "POST", json });
      setReport({ added: res.added.length, rows: res.rows, skipped: res.skipped });
      if (source === "paste") setText("");
      if (source === "customers") setPicked([]);
      if (source === "manual") setPerson({ name: "", email: "", company: "", title: "" });
      await onChange();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(url: string, method: string) {
    onError(null);
    try {
      await api(url, { method });
      await onChange();
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  const canAdd = source === "paste" ? Boolean(text.trim()) : source === "customers" ? picked.length > 0 : Boolean(person.email.trim());

  return (
    <div className="cp-recipients">
      <form className="panel cp-add" onSubmit={add} data-testid="add-recipients">
        <div className="panel-head">
          <h2 style={{ fontSize: "var(--text-base)" }}>Add people</h2>
        </div>
        <div className="panel-body stack">
          <Segmented
            label="How to add people"
            value={source}
            onChange={(v) => setSource(v)}
            options={[
              { value: "paste", label: "Paste or CSV" },
              { value: "customers", label: "Customers", count: customers.length },
              { value: "manual", label: "One person" },
            ]}
            testId="recipient-source"
          />
          {source === "paste" && (
            <>
              <label>
                <span>
                  People{" "}
                  <span className="hint">
                    (one per line: name, email, company; or a CSV with a header row: name, email, company, title, and any other column becomes a
                    variable such as <code>{"{{plan}}"}</code>)
                  </span>
                </span>
                <textarea
                  id="campaign-people"
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={"Ada Lovelace, ada@example.com, Engines Ltd\ngrace@example.com"}
                />
              </label>
              <label className="button secondary small" style={{ flexDirection: "row", alignSelf: "flex-start" }}>
                <Icon name="upload" />
                Load a CSV file
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  data-testid="campaign-csv"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setText(await file.text());
                    e.target.value = "";
                  }}
                />
              </label>
            </>
          )}
          {source === "customers" &&
            (customers.length === 0 ? (
              <p className="muted small" data-testid="no-customers">
                No customers with an email address yet. Customers are saved as testimonials come in, or when you add them by hand.
              </p>
            ) : (
              <div className="stack" data-testid="customer-picker">
                <label>
                  Find a customer
                  <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name, email or company" />
                </label>
                <ul className="cp-pick" aria-label="Customers">
                  {shown.slice(0, 200).map((p) => {
                    const already = inCampaign.has(p.email.toLowerCase());
                    return (
                      <li key={p.id}>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={picked.includes(p.id)}
                            disabled={already}
                            onChange={(e) => setPicked((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)))}
                          />
                          <span>
                            {p.name} <span className="muted xsmall">{p.email}</span>
                            {already && <span className="muted xsmall"> · already in this campaign</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {shown.length > 200 && <p className="muted xsmall">Showing 200 of {shown.length}. Type to narrow the list.</p>}
              </div>
            ))}
          {source === "manual" && (
            <div className="cp-person">
              <label>
                Name
                <input type="text" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} maxLength={120} />
              </label>
              <label>
                Email
                <input type="email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} maxLength={254} required />
              </label>
              <label>
                Company <span className="hint">(optional)</span>
                <input type="text" value={person.company} onChange={(e) => setPerson({ ...person, company: e.target.value })} maxLength={120} />
              </label>
              <label>
                Job title <span className="hint">(optional)</span>
                <input type="text" value={person.title} onChange={(e) => setPerson({ ...person, title: e.target.value })} maxLength={120} />
              </label>
            </div>
          )}
          <div className="row">
            <button type="submit" disabled={busy || !canAdd}>
              {busy ? "Adding…" : c.status === "active" && emailOn ? "Add and send" : "Add people"}
            </button>
            {c.status !== "active" && <span className="muted xsmall">Nobody is emailed until you start the campaign.</span>}
          </div>
          {report && (
            <div role="status" className="cp-report" data-testid="import-report">
              <p>
                Added {report.added} {report.added === 1 ? "person" : "people"}
                {report.skipped.length ? `, skipped ${report.skipped.length}:` : "."}
              </p>
              {report.skipped.length > 0 && (
                <ul className="notes">
                  {report.skipped.map((s, i) => (
                    <li key={i} data-reason={s.reason}>
                      {s.line ? `Line ${s.line}: ` : ""}
                      {s.email || s.text || "(empty)"} · {REASON_LABEL[s.reason]}
                      {s.reason === "invalid" && s.detail !== REASON_LABEL.invalid ? ` (${s.detail})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </form>

      <section aria-label="Recipients" className="stack">
        {recipients.length === 0 ? (
          <EmptyState
            icon="mail"
            title="Nobody in this campaign yet"
            testId="recipients-empty"
            level={3}
            action={
              <button type="button" onClick={() => document.getElementById("campaign-people")?.focus()}>
                Add people
              </button>
            }
          >
            <p>Paste a list, load a CSV, pick customers or add one person. You can also send people in through the API or a webhook (Auto-collect).</p>
          </EmptyState>
        ) : (
          <div className="panel">
            <table className="cp-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Step</th>
                  <th scope="col">Email</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id} data-testid="recipient-row" data-stage={r.stage} data-email-status={r.emailStatus} data-email={r.email}>
                    <td>
                      <strong>{r.name || r.email}</strong>
                      <div className="muted xsmall">{[r.name ? r.email : null, r.title, r.company].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td>
                      <span className="cp-stage" data-stage={r.stage}>
                        {STAGE_LABEL[r.stage]}
                      </span>
                      {trail(r) && <div className="muted xsmall">{trail(r)}</div>}
                    </td>
                    <td className={r.emailStatus === "failed" || r.emailStatus === "bounced" || r.emailError ? "error-text small" : "muted small"}>{emailSummary(r, c)}</td>
                    <td>
                      <div className="cp-row-actions">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={async () => {
                            if (await copyText(r.link)) {
                              setCopied(r.id);
                              setTimeout(() => setCopied((id) => (id === r.id ? null : id)), 1600);
                            }
                          }}
                        >
                          <Icon name={copied === r.id ? "check" : "copy"} />
                          {copied === r.id ? "Copied" : "Copy link"}
                        </button>
                        {emailOn && c.status === "active" && r.status === "waiting" && r.emailStatus !== "queued" && (
                          <button type="button" className="ghost small" onClick={() => act(`/api/admin/requests/${r.id}/send`, "POST")}>
                            {r.emailStatus === "not_sent" ? "Send email" : "Send again"}
                          </button>
                        )}
                        <button type="button" className="ghost small" aria-label={`Remove ${r.email}`} onClick={() => setRemoving(r)}>
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

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.email ?? ""}?`}
        confirmLabel="Remove"
        busyLabel="Removing…"
        danger
        onConfirm={async () => {
          await act(`/api/admin/requests/${removing!.id}`, "DELETE");
          setRemoving(null);
        }}
      >
        <p>Their personal link stops working and no more reminders go out. A testimonial they already sent stays.</p>
      </ConfirmDialog>
    </div>
  );
}
