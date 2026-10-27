"use client";

import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, CopyField } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { AdminCampaign } from "@/lib/campaigns";

type Props = { campaign: AdminCampaign; apiBase: string; onChange: () => Promise<void> };

/**
 * REQ-07: invites from your other tools. The API takes a key from Settings;
 * the incoming webhook URL carries its own secret token, shown once.
 */
export function AutoCollectPanel({ campaign: c, apiBase, onChange }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"regenerate" | "off" | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setUrl((await api<{ url: string }>(`/api/admin/campaigns/${c.id}/webhook`, { method: "POST" })).url);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const curl = `curl -X POST ${apiBase}/invites \\
  -H "Authorization: Bearer plk_…" -H "Content-Type: application/json" \\
  -d '{"campaignId":"${c.id}","email":"ada@example.com","name":"Ada Lovelace","company":"Engines Ltd","delayDays":3}'`;

  return (
    <div className="stack-lg" data-testid="auto-collect">
      {c.status !== "active" && (
        <p className="notice" data-testid="auto-collect-inactive">
          Invites from the API or the webhook are accepted only while the campaign is sending. {c.status === "draft" ? "Start it" : "Resume it"} first;
          until then they get a 409 answer.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: "var(--text-base)" }}>Incoming webhook</h2>
          <span className="cp-badge" data-state={c.webhook.on ? "active" : "draft"} data-testid="webhook-state">
            {c.webhook.on ? "On" : "Off"}
          </span>
        </div>
        <div className="panel-body stack">
          <p className="muted small">
            Point your shop, CRM or automation tool (n8n, Zapier, Make) at this URL. Each <code>POST</code> of JSON such as{" "}
            <code>{'{"email":"ada@example.com","name":"Ada","company":"Engines Ltd","plan":"Pro"}'}</code> adds the person and sends the
            invitation. Extra fields become template variables. Add <code>&quot;delayDays&quot;: 3</code> (or <code>?delay=3</code>) to send it
            three days later. People already in the campaign, unsubscribed or who already responded are skipped.
          </p>
          {url ? (
            <CopyField
              label="Webhook URL"
              value={url}
              copyLabel="Copy URL"
              testId="webhook-url"
              hint="Copy it now: Plaudit keeps only a fingerprint of it, so it can't show it again. Treat it like a password."
            />
          ) : c.webhook.on ? (
            <p className="small" data-testid="webhook-prefix">
              A URL is set up (its token starts with <code>{c.webhook.prefix}…</code>). Lost it? Make a new one; the old one stops working.
            </p>
          ) : null}
          <div className="row">
            {c.webhook.on || url ? (
              <>
                <button type="button" className="secondary" disabled={busy} onClick={() => setConfirm("regenerate")}>
                  <Icon name="undo" />
                  Regenerate URL
                </button>
                <button type="button" className="secondary danger" disabled={busy} onClick={() => setConfirm("off")}>
                  Turn off
                </button>
              </>
            ) : (
              <button type="button" onClick={generate} disabled={busy}>
                <Icon name="link" />
                {busy ? "Creating…" : "Create webhook URL"}
              </button>
            )}
          </div>
          <p className="muted xsmall">Each URL takes up to 120 invites a minute and bodies up to 16 KB.</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: "var(--text-base)" }}>REST API</h2>
        </div>
        <div className="panel-body stack">
          <CopyField label="Campaign ID" value={c.id} testId="campaign-id" />
          <CopyField
            label="Example request"
            value={curl}
            multiline
            rows={4}
            hint={
              <>
                Needs a read-and-write API key from <a href="/admin/settings">Settings</a>. See docs/API.md for the answers it gives.
              </>
            }
          />
        </div>
      </section>

      <ConfirmDialog
        open={confirm === "regenerate"}
        onClose={() => setConfirm(null)}
        title="Make a new webhook URL?"
        confirmLabel="Regenerate URL"
        busyLabel="Creating…"
        onConfirm={async () => {
          await generate();
          setConfirm(null);
        }}
      >
        <p>The current URL stops working at once. Update it wherever you used it.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "off"}
        onClose={() => setConfirm(null)}
        title="Turn the webhook off?"
        confirmLabel="Turn off"
        busyLabel="Turning off…"
        danger
        onConfirm={async () => {
          await api(`/api/admin/campaigns/${c.id}/webhook`, { method: "DELETE" });
          setUrl(null);
          await onChange();
          setConfirm(null);
        }}
      >
        <p>The URL stops working. You can make a new one later.</p>
      </ConfirmDialog>
    </div>
  );
}
