"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { CopyField } from "@/components/admin";
import type { AdminTrigger } from "@/lib/campaign-triggers";

const NAME = { stripe: "Stripe", shopify: "Shopify" } as const;
const EVENTS = { stripe: ["checkout.session.completed", "invoice.paid"], shopify: ["orders/fulfilled", "orders/paid"] } as const;
const EVENT_LABEL: Record<string, string> = {
  "checkout.session.completed": "A Checkout payment succeeds",
  "invoice.paid": "An invoice is paid (subscriptions)",
  "orders/fulfilled": "An order is fulfilled",
  "orders/paid": "An order is paid",
};
const SECRET_HELP = {
  stripe: "In Stripe, Developers › Webhooks › your endpoint › Signing secret (it starts with whsec_).",
  shopify: "In Shopify, Settings › Notifications › Webhooks: the key shown under the list (or your app's client secret).",
} as const;

/** REQ-07: native Stripe and Shopify triggers on the Auto-collect tab. */
export function TriggersSection({ campaignId }: { campaignId: string }) {
  const [triggers, setTriggers] = useState<AdminTrigger[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setTriggers((await api<{ triggers: AdminTrigger[] }>(`/api/admin/campaigns/${campaignId}/triggers`)).triggers);
  }, [campaignId]);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  async function add(provider: "stripe" | "shopify") {
    setError(null);
    try {
      await api(`/api/admin/campaigns/${campaignId}/triggers`, { method: "POST", json: { provider, delayDays: 7 } });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="panel" data-testid="triggers">
      <div className="panel-head">
        <h2 style={{ fontSize: "var(--text-base)" }}>Stripe and Shopify</h2>
      </div>
      <div className="panel-body stack">
        <p className="muted small">
          Invite buyers automatically: after a paid Stripe checkout or invoice, or a fulfilled Shopify order, the buyer gets this campaign&apos;s invitation, as
          many days later as you choose. Each delivery must carry Stripe&apos;s or Shopify&apos;s signature, so nobody else can add people.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {triggers?.map((t) => (
          <TriggerCard key={t.id} trigger={t} onChange={load} onError={setError} />
        ))}
        <div className="row">
          <button type="button" className="secondary" onClick={() => add("stripe")} data-testid="add-stripe">
            Add a Stripe trigger
          </button>
          <button type="button" className="secondary" onClick={() => add("shopify")} data-testid="add-shopify">
            Add a Shopify trigger
          </button>
        </div>
      </div>
    </section>
  );
}

function TriggerCard({ trigger: t, onChange, onError }: { trigger: AdminTrigger; onChange: () => Promise<void>; onError: (e: string | null) => void }) {
  const [secret, setSecret] = useState("");
  const [delay, setDelay] = useState(String(t.delayDays));
  const [busy, setBusy] = useState(false);
  const url = `/api/admin/campaigns/${t.campaignId}/triggers/${t.id}`;

  async function save(json: Record<string, unknown>) {
    setBusy(true);
    onError(null);
    try {
      await api(url, { method: "PATCH", json });
      setSecret("");
      await onChange();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" data-testid="trigger" data-provider={t.provider}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{NAME[t.provider]}</strong>
        <span className="cp-badge" data-state={t.enabled && t.secretSet ? "active" : "draft"} data-testid="trigger-state">
          {!t.secretSet ? "Needs its signing secret" : t.enabled ? "On" : "Off"}
        </span>
      </div>
      <CopyField label="Endpoint URL" value={t.url} copyLabel="Copy URL" testId="trigger-url" hint={`Add it in ${NAME[t.provider]} as a webhook endpoint.`} />
      <fieldset className="stack" style={{ gap: "var(--space-1)", border: 0, padding: 0 }}>
        <legend className="small">When</legend>
        {EVENTS[t.provider].map((e) => (
          <label key={e} className="row small" style={{ gap: "var(--space-2)" }}>
            <input
              type="checkbox"
              checked={t.events.includes(e)}
              disabled={busy}
              onChange={(ev) => save({ events: ev.target.checked ? [...t.events, e] : t.events.filter((x) => x !== e) })}
            />
            {EVENT_LABEL[e]} <code className="xsmall">{e}</code>
          </label>
        ))}
      </fieldset>
      <form
        className="row"
        style={{ alignItems: "end" }}
        onSubmit={(e) => {
          e.preventDefault();
          void save({ delayDays: Number(delay), ...(secret ? { secret } : {}) });
        }}
      >
        <label>
          Days to wait
          <input type="number" min={0} max={365} value={delay} onChange={(e) => setDelay(e.target.value)} style={{ width: "6rem" }} />
        </label>
        <label style={{ flex: "1 1 16rem" }}>
          Signing secret
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={t.secretSet ? "Saved. Paste a new one to replace it" : t.provider === "stripe" ? "whsec_…" : "Shopify's webhook key"}
            data-testid="trigger-secret"
          />
        </label>
        <button type="submit" disabled={busy}>
          Save
        </button>
      </form>
      <p className="muted xsmall">{SECRET_HELP[t.provider]} Plaudit keeps it to check signatures and never shows it again.</p>
      {t.lastResult && (
        <p className="small" data-testid="trigger-last">
          Last delivery{t.lastEventAt ? ` (${new Date(t.lastEventAt).toLocaleString()})` : ""}: {t.lastResult}
        </p>
      )}
      <div className="row">
        <button type="button" className="ghost small" disabled={busy} onClick={() => save({ enabled: !t.enabled })}>
          {t.enabled ? "Turn off" : "Turn on"}
        </button>
        <button
          type="button"
          className="ghost small danger"
          disabled={busy}
          onClick={async () => {
            if (!confirm(`Delete this ${NAME[t.provider]} trigger? Deliveries to its URL stop working.`)) return;
            await api(url, { method: "DELETE" }).catch((err) => onError(errorMessage(err)));
            await onChange();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
