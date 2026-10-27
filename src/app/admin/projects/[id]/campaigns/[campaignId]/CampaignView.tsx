"use client";

import "@/app/admin/campaigns.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, Tabs, UnsavedGuard } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { AdminCampaign, CampaignRewardPool, AdminRecipient, Funnel } from "@/lib/campaigns";
import { STATUS_LABEL } from "../labels";
import { AutoCollectPanel } from "./AutoCollectPanel";
import { EmailPanel, type Draft } from "./EmailPanel";
import { RecipientsPanel } from "./RecipientsPanel";

export type Customer = { id: string; name: string; email: string; company: string | null; title: string | null };
export type FormChoice = { id: string; name: string; isDefault: boolean };
export type EmailInfo = { mode: "smtp" | "outbox" | "off"; from: string | null; me: string | null };
type Data = { campaign: AdminCampaign; recipients: AdminRecipient[]; customers: Customer[]; rewardPool: CampaignRewardPool };

type Props = {
  project: { id: string; name: string };
  email: EmailInfo;
  apiBase: string;
  forms: FormChoice[];
  initial: Data;
};

const TABS = [
  { id: "recipients", label: "Recipients" },
  { id: "email", label: "Email" },
  { id: "auto", label: "Auto-collect" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function draftOf(c: AdminCampaign): Draft {
  return {
    name: c.name,
    formId: c.formId,
    senderName: c.senderName,
    replyTo: c.replyTo,
    subject: c.subject,
    body: c.body,
    buttonText: c.buttonText,
    rtl: c.rtl,
    reminders: c.reminders,
    trackOpens: c.trackOpens,
    rewardCodes: c.rewardCodes,
  };
}

/** REQ-01..07: one campaign's page. The email's unsaved wording lives here, so starting the campaign saves it first. */
export function CampaignView({ project, email, apiBase, forms, initial }: Props) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<TabId>(initial.recipients.length ? "recipients" : "email");
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial.campaign));
  const [saved, setSaved] = useState<Draft>(() => draftOf(initial.campaign));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"start" | "delete" | null>(null);
  const c = data.campaign;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/admin/campaigns/${c.id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [c.id]);

  // Refresh while invitations are going out now (not ones scheduled for later).
  const sending = data.recipients.some((r) => r.emailStatus === "queued" && (!r.scheduledFor || new Date(r.scheduledFor).getTime() < Date.now() + 5000));
  useEffect(() => {
    if (!sending) return;
    const id = setInterval(() => void load(), 2000);
    return () => clearInterval(id);
  }, [sending, load]);

  /** Saves the email settings; with `status`, also starts, pauses or resumes. */
  async function save(status?: "active" | "paused") {
    setError(null);
    const { campaign } = await api<{ campaign: AdminCampaign }>(`/api/admin/campaigns/${c.id}`, {
      method: "PATCH",
      json: { ...draft, ...(status ? { status } : {}) },
    });
    setSaved(draftOf(campaign));
    setDraft(draftOf(campaign));
    await load();
    return campaign;
  }

  const unsent = data.recipients.filter((r) => r.status === "waiting" && r.emailStatus === "not_sent").length;

  return (
    <div className="stack-lg">
      <UnsavedGuard dirty={dirty} />
      <div className="page-head cp-head">
        <div>
          <h1>{c.name}</h1>
          <p className="muted">
            <span className="cp-badge" data-state={c.status} data-testid="campaign-status">
              {STATUS_LABEL[c.status]}
            </span>{" "}
            {c.status === "draft"
              ? "Nothing is sent until you start it."
              : c.status === "paused"
                ? "Paused: no invitations or reminders go out until you resume it."
                : "Invitations go out as people are added; reminders follow on schedule."}
          </p>
        </div>
        <div className="row cp-actions">
          {c.status === "active" ? (
            <button type="button" className="secondary" onClick={() => save("paused").catch((err) => setError(errorMessage(err)))}>
              <Icon name="pause" />
              Pause
            </button>
          ) : (
            <button
              type="button"
              className="accent"
              disabled={email.mode === "off"}
              title={email.mode === "off" ? "Email isn't set up on this server" : undefined}
              onClick={() => setConfirm("start")}
            >
              <Icon name="play" />
              {c.status === "draft" ? "Start campaign" : "Resume"}
            </button>
          )}
          <button type="button" className="secondary danger" onClick={() => setConfirm("delete")}>
            <Icon name="trash" />
            Delete
          </button>
        </div>
      </div>

      {email.mode === "off" && (
        <p className="notice warn" data-testid="campaign-email-off">
          Email isn&apos;t set up on this server, so this campaign can&apos;t send. You can still write it, add people and copy their
          personal links. To send, set <code>SMTP_URL</code> and <code>SMTP_FROM</code> (see docs/EMAIL.md).
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <FunnelView funnel={c.funnel!} trackOpens={c.trackOpens} />

      <Tabs label="Campaign sections" tabs={TABS.map((t) => (t.id === "recipients" ? { ...t, count: data.recipients.length } : t))} value={tab}
        onChange={(id) => {
          setTab(id as TabId);
          // People may have come in through the API or the webhook meanwhile.
          void load();
        }}
        testId="campaign-tabs"
      >
        {tab === "recipients" && (
          <RecipientsPanel campaign={c} recipients={data.recipients} customers={data.customers} emailOn={email.mode !== "off"} onChange={load} onError={setError} />
        )}
        {tab === "email" && (
          <EmailPanel
            campaign={c}
            projectName={project.name}
            draft={draft}
            setDraft={setDraft}
            dirty={dirty}
            onSave={() => save()}
            forms={forms}
            email={email}
            recipients={data.recipients}
            rewardPool={data.rewardPool}
          />
        )}
        {tab === "auto" && <AutoCollectPanel campaign={c} apiBase={apiBase} onChange={load} />}
      </Tabs>

      <ConfirmDialog
        open={confirm === "start"}
        onClose={() => setConfirm(null)}
        title={c.status === "draft" ? `Start “${c.name}”?` : `Resume “${c.name}”?`}
        confirmLabel={c.status === "draft" ? "Start sending" : "Resume"}
        busyLabel="Starting…"
        testId="campaign-start-dialog"
        onConfirm={async () => {
          await save("active");
          setConfirm(null);
        }}
      >
        <p>
          {unsent
            ? `${unsent} ${unsent === 1 ? "person gets" : "people get"} the invitation now, and anyone you add later gets it straight away.`
            : "Nobody is waiting for an invitation yet. People you add from now on get it straight away."}
          {dirty ? " Your changes to the email are saved first." : ""}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title={`Delete “${c.name}”?`}
        confirmLabel="Delete campaign"
        busyLabel="Deleting…"
        danger
        onConfirm={async () => {
          await api(`/api/admin/campaigns/${c.id}`, { method: "DELETE" });
          router.push(`/admin/projects/${project.id}/campaigns`);
        }}
      >
        <p>
          Its {data.recipients.length} recipient{data.recipients.length === 1 ? "" : "s"} and their personal links go with it, and no more
          reminders are sent. Testimonials they already sent stay.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** REQ-04: how far people got, in order, then the ways out. */
function FunnelView({ funnel: f, trackOpens }: { funnel: Funnel; trackOpens: boolean }) {
  const steps: { id: string; label: string; n: number; hint?: string }[] = [
    { id: "recipients", label: "People", n: f.recipients },
    { id: "sent", label: "Sent", n: f.sent },
    ...(trackOpens && f.opened !== null ? [{ id: "opened", label: "Opened", n: f.opened, hint: "Includes people who clicked: many mail apps hide images" }] : []),
    { id: "clicked", label: "Clicked", n: f.clicked },
    { id: "started", label: "Started", n: f.started },
    { id: "submitted", label: "Responded", n: f.submitted },
  ];
  const outs = [
    { id: "declined", label: "Said no thanks", n: f.declined },
    { id: "unsubscribed", label: "Unsubscribed", n: f.unsubscribed },
    { id: "bounced", label: "Bounced", n: f.bounced },
    { id: "failed", label: "Failed", n: f.failed },
  ];
  const max = Math.max(f.recipients, 1);
  return (
    <section className="panel" aria-labelledby="funnel-title">
      <div className="panel-head">
        <h2 id="funnel-title" style={{ fontSize: "var(--text-base)" }}>
          Funnel
        </h2>
        {!trackOpens && <span className="muted xsmall">Opens aren&apos;t tracked for this campaign</span>}
      </div>
      <div className="panel-body">
        <ol className="cp-funnel" data-testid="funnel">
          {steps.map((s) => (
            <li key={s.id} data-stage={s.id} title={s.hint}>
              <strong data-testid={`funnel-${s.id}`}>{s.n}</strong>
              <span>{s.label}</span>
              <span className="cp-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((s.n / max) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ol>
        <ul className="cp-outs">
          {outs.map((o) => (
            <li key={o.id} data-stage={o.id}>
              <strong data-testid={`funnel-${o.id}`}>{o.n}</strong> {o.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
