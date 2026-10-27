"use client";

import "@/app/admin/campaigns.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { EmptyState } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { AdminCampaign } from "@/lib/campaigns";
import { STATUS_LABEL } from "./labels";

type Props = {
  projectId: string;
  emailOn: boolean;
  forms: { id: string; name: string; isDefault: boolean }[];
  initial: AdminCampaign[];
};

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

/** REQ-01: every campaign with its numbers, and a new one. */
export function CampaignsList({ projectId, emailOn, forms, initial }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [formId, setFormId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { campaign } = await api<{ campaign: AdminCampaign }>(`/api/admin/projects/${projectId}/campaigns`, {
        method: "POST",
        json: { name, formId: formId || null },
      });
      router.push(`/admin/projects/${projectId}/campaigns/${campaign.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      {!emailOn && (
        <p className="notice warn" data-testid="campaign-email-off">
          Email isn&apos;t set up on this server, so campaigns can&apos;t send yet. You can still write one and add people. To send,
          set <code>SMTP_URL</code> and <code>SMTP_FROM</code> (see docs/EMAIL.md).
        </p>
      )}
      <form className="panel" onSubmit={create} data-testid="new-campaign">
        <div className="panel-body cp-new">
          <label>
            New campaign name
            <input id="new-campaign-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Spring customers" />
          </label>
          {forms.length > 1 && (
            <label>
              Form the links open
              <select value={formId} onChange={(e) => setFormId(e.target.value)}>
                {forms.map((f) => (
                  <option key={f.id} value={f.isDefault ? "" : f.id}>
                    {f.name}
                    {f.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="accent" disabled={busy || !name.trim()}>
            <Icon name="plus" />
            {busy ? "Creating…" : "Create campaign"}
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {initial.length === 0 ? (
        <EmptyState
          icon="mail"
          title="No campaigns yet"
          testId="campaigns-empty"
          action={
            <button type="button" onClick={() => document.getElementById("new-campaign-name")?.focus()}>
              Create a campaign
            </button>
          }
        >
          <p>A campaign starts as a draft: write the email, add people, preview it, then start it when you&apos;re ready.</p>
        </EmptyState>
      ) : (
        <div className="panel">
          <table className="cp-table" data-testid="campaigns-table">
            <thead>
              <tr>
                <th scope="col">Campaign</th>
                <th scope="col">Status</th>
                <th scope="col">People</th>
                <th scope="col">Sent</th>
                <th scope="col">Clicked</th>
                <th scope="col">Responded</th>
              </tr>
            </thead>
            <tbody>
              {initial.map((c) => {
                const f = c.funnel!;
                return (
                  <tr key={c.id} data-testid="campaign-row" data-status={c.status}>
                    <td>
                      <Link className="cp-name" href={`/admin/projects/${projectId}/campaigns/${c.id}`}>
                        {c.name}
                      </Link>
                      <div className="muted xsmall">Created {new Date(c.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</div>
                    </td>
                    <td>
                      <span className="cp-badge" data-state={c.status}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td data-label="People" data-testid="campaign-recipients">{f.recipients}</td>
                    <td data-label="Sent">{f.sent}</td>
                    <td data-label="Clicked">
                      {f.clicked} <span className="muted xsmall">{pct(f.clicked, f.sent)}</span>
                    </td>
                    <td data-label="Responded" data-testid="campaign-responded">
                      {f.submitted} <span className="muted xsmall">{pct(f.submitted, f.recipients)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
