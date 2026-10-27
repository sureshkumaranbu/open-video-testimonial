"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Segmented, Toggle } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { AdminCampaign, AdminRecipient } from "@/lib/campaigns";
import type { SenderAuth } from "@/lib/sender-auth";
import type { EmailInfo, FormChoice } from "./CampaignView";

/** The campaign settings the editor changes (saved with PATCH). */
export type Draft = {
  name: string;
  formId: string | null;
  senderName: string;
  replyTo: string;
  subject: string;
  body: string;
  buttonText: string;
  rtl: boolean;
  reminders: number[];
  trackOpens: boolean;
};

type Preview = { from: string; replyTo: string | null; to: string; subject: string; text: string; html: string };
type TestResult = { ok: true; to: string; subject: string; auth: SenderAuth } | { ok: false; error: string; hint?: string | null; auth?: SenderAuth };

type Props = {
  campaign: AdminCampaign;
  projectName: string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  dirty: boolean;
  onSave: () => Promise<unknown>;
  forms: FormChoice[];
  email: EmailInfo;
  recipients: AdminRecipient[];
};

const VARIABLES = ["{{name}}", "{{first_name}}", "{{company}}", "{{title}}", "{{project}}", "{{link}}"];

/** REQ-01, REQ-03 and REQ-06: the wording and schedule, a live preview of the real email, and a test send with the sender check. */
export function EmailPanel({ campaign: c, projectName, draft, setDraft, dirty, onSave, forms, email, recipients }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [view, setView] = useState<"html" | "text">("html");
  const [as, setAs] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });

  // The preview comes from the server's own renderer, a moment after typing stops.
  const content = { subject: draft.subject, body: draft.body, buttonText: draft.buttonText, rtl: draft.rtl, senderName: draft.senderName, replyTo: draft.replyTo };
  const key = JSON.stringify([content, as]);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await api<{ preview: Preview }>(`/api/admin/campaigns/${c.id}/preview`, {
          method: "POST",
          json: { ...JSON.parse(key)[0], recipientId: JSON.parse(key)[1] || null },
          signal: ctrl.signal,
        });
        setPreview(res.preview);
        setPreviewError(null);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setPreviewError(errorMessage(err));
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [c.id, key]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await onSave();
      setStatus("Saved");
    } catch (err) {
      setStatus(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await api<{ to: string; subject: string; auth: SenderAuth }>(`/api/admin/campaigns/${c.id}/test`, { method: "POST", json: content });
      setTest({ ok: true, ...res });
    } catch (err) {
      const data = (err as { data?: { hint?: string | null; auth?: SenderAuth } }).data;
      setTest({ ok: false, error: errorMessage(err), hint: data?.hint, auth: data?.auth });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="cp-email">
      <form className="panel" onSubmit={save} data-testid="campaign-email-form">
        <div className="panel-head">
          <h2 style={{ fontSize: "var(--text-base)" }}>Email and schedule</h2>
          {dirty && <span className="muted xsmall" data-testid="campaign-unsaved">Unsaved changes</span>}
        </div>
        <div className="panel-body stack">
          <label>
            Campaign name
            <input type="text" value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required />
          </label>
          {forms.length > 1 && (
            <label>
              Form the links open
              <select value={draft.formId ?? ""} onChange={(e) => set("formId", e.target.value || null)}>
                {forms.map((f) => (
                  <option key={f.id} value={f.isDefault ? "" : f.id}>
                    {f.name}
                    {f.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="cp-two">
            <label>
              <span>
                Sender name <span className="hint">(optional)</span>
              </span>
              <input type="text" value={draft.senderName} onChange={(e) => set("senderName", e.target.value)} maxLength={80} placeholder={projectName} />
            </label>
            <label>
              <span>
                Reply-to <span className="hint">(optional)</span>
              </span>
              <input type="email" value={draft.replyTo} onChange={(e) => set("replyTo", e.target.value)} maxLength={254} placeholder="you@example.com" />
            </label>
          </div>
          {email.from && <p className="muted xsmall">Mail is sent from the address in SMTP_FROM ({email.from}); the sender name replaces its name.</p>}
          <label>
            Subject
            <input type="text" value={draft.subject} onChange={(e) => set("subject", e.target.value)} maxLength={200} />
          </label>
          <label>
            Message
            <textarea value={draft.body} onChange={(e) => set("body", e.target.value)} rows={10} maxLength={10_000} dir={draft.rtl ? "rtl" : undefined} />
          </label>
          <p className="muted xsmall" data-testid="campaign-variables">
            Filled in for each person: {VARIABLES.map((v, i) => (
              <span key={v}>
                {i ? ", " : ""}
                <code>{v}</code>
              </span>
            ))}
            , and any extra CSV column (<code>{"{{plan}}"}</code> for a “plan” column). <code>{"{{link}}"}</code> on a line of its own becomes the
            button. A “No thanks” and an unsubscribe link are always added.
          </p>
          <label>
            Button text
            <input type="text" value={draft.buttonText} onChange={(e) => set("buttonText", e.target.value)} maxLength={60} />
          </label>
          <Toggle label="Right-to-left text" hint="For Arabic, Hebrew, Persian or Urdu wording." checked={draft.rtl} onChange={(v) => set("rtl", v)} testId="campaign-rtl" />

          <fieldset className="cp-reminders" data-testid="campaign-reminders">
            <legend>Reminders</legend>
            <p className="muted xsmall">Days after the invitation, up to three. They stop as soon as the person responds, says no thanks or unsubscribes.</p>
            {draft.reminders.length === 0 && <p className="muted small">No reminders.</p>}
            {draft.reminders.map((d, i) => (
              <div className="row cp-reminder" key={i}>
                <label>
                  Reminder {i + 1}, days after the invitation
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={d || ""}
                    onChange={(e) => set("reminders", draft.reminders.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                    required
                  />
                </label>
                <button type="button" className="ghost small" aria-label={`Remove reminder ${i + 1}`} onClick={() => set("reminders", draft.reminders.filter((_, j) => j !== i))}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
            {draft.reminders.length < 3 && (
              <button
                type="button"
                className="secondary small"
                onClick={() => set("reminders", [...draft.reminders, Math.min((draft.reminders.at(-1) ?? 0) + 4, 60)])}
              >
                <Icon name="plus" />
                Add a reminder
              </button>
            )}
          </fieldset>

          <Toggle
            label="Track opens"
            hint="Adds a tiny image from this server to the email, so you can see who opened it. Off by default for privacy; clicks and responses are tracked either way."
            checked={draft.trackOpens}
            onChange={(v) => set("trackOpens", v)}
            testId="campaign-track-opens"
          />
          <div className="row">
            <button type="submit" disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
            {status && (
              <span className="muted small" role="status">
                {status}
              </span>
            )}
          </div>
        </div>
      </form>

      <section className="panel cp-preview" aria-labelledby="preview-title">
        <div className="panel-head">
          <h2 id="preview-title" style={{ fontSize: "var(--text-base)" }}>
            Preview
          </h2>
          <Segmented label="Preview format" value={view} onChange={setView} options={[{ value: "html", label: "Email" }, { value: "text", label: "Plain text" }]} />
        </div>
        <div className="panel-body stack">
          <label>
            Preview as
            <select value={as} onChange={(e) => setAs(e.target.value)} data-testid="preview-as">
              <option value="">A sample person</option>
              {recipients.slice(0, 100).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name ? `${r.name} (${r.email})` : r.email}
                </option>
              ))}
            </select>
          </label>
          {previewError && (
            <p className="error" role="alert">
              {previewError}
            </p>
          )}
          {preview && (
            <div className="cp-mail" data-testid="campaign-preview">
              <dl className="cp-headers">
                <dt>From</dt>
                <dd>{preview.from}</dd>
                {preview.replyTo && (
                  <>
                    <dt>Reply-to</dt>
                    <dd>{preview.replyTo}</dd>
                  </>
                )}
                <dt>To</dt>
                <dd>{preview.to}</dd>
                <dt>Subject</dt>
                <dd data-testid="preview-subject">{preview.subject}</dd>
              </dl>
              {view === "html" ? (
                // No scripts and no same-origin access: only the email's own markup.
                <iframe className="cp-frame" title="Email preview" sandbox="" srcDoc={preview.html} data-testid="preview-frame" />
              ) : (
                <pre className="cp-text" data-testid="preview-text">
                  {preview.text}
                </pre>
              )}
              {draft.trackOpens && <p className="muted xsmall">The open pixel is left out of the preview, so looking at it never counts as an open.</p>}
            </div>
          )}
          <div className="cp-test stack">
            <div className="row">
              <button type="button" className="secondary" onClick={sendTest} disabled={testing || email.mode === "off"} data-testid="send-test">
                <Icon name="mail" />
                {testing ? "Sending…" : "Send a test to me"}
              </button>
              {email.me && <span className="muted xsmall">Goes to {email.me}, with a sample person.</span>}
            </div>
            {test && <TestOutcome result={test} />}
          </div>
        </div>
      </section>
    </div>
  );
}

/** The test send's result, and what DNS says about the From domain (REQ-06): reported, never enforced. */
function TestOutcome({ result }: { result: TestResult }) {
  const auth = result.auth;
  return (
    <div data-testid="campaign-test-result" role="status" className="stack">
      {result.ok ? (
        <p className="small">
          <Icon name="check" /> Sent “{result.subject}” to {result.to}.
        </p>
      ) : (
        <div className="error">
          <p>{result.error}</p>
          {result.hint && <p className="small">{result.hint}</p>}
        </div>
      )}
      {auth && (
        <div className="cp-auth" data-testid="sender-auth">
          <p className="small">
            <strong>Sender check for {auth.domain || "the From address"}</strong>
          </p>
          {auth.checked ? (
            <ul className="notes">
              <li data-record="spf" data-found={Boolean(auth.spf)}>
                SPF: {auth.spf ? <code>{auth.spf}</code> : "no record found. Add the TXT record your mail provider gives you."}
              </li>
              <li data-record="dmarc" data-found={Boolean(auth.dmarc)}>
                DMARC: {auth.dmarc ? <code>{auth.dmarc}</code> : "no record found at _dmarc. See docs/EMAIL.md for a starting record."}
              </li>
            </ul>
          ) : null}
          {auth.note && <p className="muted xsmall">{auth.note}</p>}
          <p className="muted xsmall">This only reports what DNS says. DKIM depends on your provider, so check it in their dashboard.</p>
        </div>
      )}
    </div>
  );
}
