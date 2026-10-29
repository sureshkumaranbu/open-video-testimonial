"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { CopyField, EmptyState, Toggle } from "@/components/admin";
import type { AdminPurchase } from "@/lib/commerce/purchases";
import type { AdminStripeConnection } from "@/lib/commerce/stripe-connection";

type State = { connection: AdminStripeConnection | null; purchases: AdminPurchase[]; purchaseCount: number };

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * INT-07: the project's Stripe connection. Admins set it up (the webhook's
 * signing secret and a restricted key are secrets, shown only as "saved");
 * everyone else sees what it recorded.
 */
export function Commerce({ projectId, admin }: { projectId: string; admin: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingSecret, setSigningSecret] = useState("");
  const [restrictedKey, setRestrictedKey] = useState("");
  const [retention, setRetention] = useState("90");
  const [defaultProduct, setDefaultProduct] = useState("");
  const url = `/api/admin/projects/${projectId}/stripe`;

  const load = useCallback(async () => {
    const s = await api<State>(url);
    setState(s);
    setRetention(String(s.connection?.retentionDays ?? 90));
    setDefaultProduct(s.connection?.defaultProduct ?? "");
  }, [url]);
  useEffect(() => {
    void load().catch((err) => setError(errorMessage(err)));
  }, [load]);

  async function save(json: Record<string, unknown>, done = "Saved.") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(url, { method: "PUT", json });
      setSigningSecret("");
      setRestrictedKey("");
      await load();
      setNotice(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string, method: string, question: string) {
    if (!confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      await api(path, { method });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading…</p>;
  const c = state.connection;

  return (
    <div className="stack-lg" data-testid="commerce">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice small" role="status">
          {notice}
        </p>
      )}
      <section className="panel" data-testid="stripe-connection">
        <div className="panel-head">
          <h2 style={{ fontSize: "var(--text-base)" }}>Stripe</h2>
          {c && (
            <span className="cp-badge" data-state={c.enabled && c.signingSecretSet ? "active" : "draft"} data-testid="stripe-state">
              {!c.signingSecretSet ? "Needs its signing secret" : c.enabled ? "On" : "Off"}
            </span>
          )}
        </div>
        <div className="panel-body stack">
          {!c && (
            <p className="muted small">
              Not connected yet. {admin ? "Save the form below to get this project's webhook address, then add it in Stripe." : "Ask an admin to connect Stripe."}
            </p>
          )}
          {c && (
            <CopyField
              label="Webhook endpoint URL"
              value={c.url}
              copyLabel="Copy URL"
              testId="stripe-url"
              hint="In Stripe: Developers › Webhooks › Add endpoint. Choose the events checkout.session.completed and invoice.paid."
            />
          )}
          {c?.lastResult && (
            <p className={c.lastEventAt ? "small" : "notice small"} data-testid="stripe-last">
              {/* No event yet: an imported connection's note to paste its secrets again. */}
              {c.lastEventAt ? `Last event (${when(c.lastEventAt)}): ${c.lastResult}` : c.lastResult}
            </p>
          )}
          {admin && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  {
                    retentionDays: Number(retention),
                    defaultProduct,
                    ...(signingSecret ? { signingSecret } : {}),
                    ...(restrictedKey ? { restrictedKey } : {}),
                  },
                  c ? "Saved." : "Connected. Copy the webhook address into Stripe.",
                );
              }}
            >
              <label>
                Signing secret
                <input
                  type="password"
                  autoComplete="off"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder={c?.signingSecretSet ? "Saved. Paste a new one to replace it" : "whsec_…"}
                  data-testid="stripe-signing-secret"
                />
                <span className="muted xsmall">Stripe shows it on the endpoint&apos;s page once it&apos;s added. Every event must be signed with it.</span>
              </label>
              <label>
                Restricted key, for thank-you coupons (optional)
                <input
                  type="password"
                  autoComplete="off"
                  value={restrictedKey}
                  onChange={(e) => setRestrictedKey(e.target.value)}
                  placeholder={c?.restrictedKeySet ? `Saved (${c.restrictedKeyHint}). Paste a new one to replace it` : "rk_live_… or rk_test_…"}
                  data-testid="stripe-restricted-key"
                />
                <span className="muted xsmall">
                  In Stripe: Developers › API keys › Create restricted key. Give it one permission only: Promotion codes, Write. Never paste your secret key (sk_…).
                </span>
              </label>
              <div className="row" style={{ alignItems: "end" }}>
                <label>
                  Keep purchases for (days)
                  <input type="number" min={1} max={365} value={retention} onChange={(e) => setRetention(e.target.value)} style={{ width: "7rem" }} data-testid="stripe-retention" />
                </label>
                <label style={{ flex: "1 1 14rem" }}>
                  When Stripe names no product, say they bought
                  <input type="text" maxLength={80} value={defaultProduct} onChange={(e) => setDefaultProduct(e.target.value)} placeholder="Leave empty for “from us”" />
                </label>
              </div>
              <div className="row">
                <button type="submit" disabled={busy} data-testid="stripe-save">
                  {c ? "Save" : "Connect Stripe"}
                </button>
              </div>
            </form>
          )}
          {admin && c && (
            <>
              <Toggle
                label="Record purchases"
                hint="Off: Stripe's events are answered but nothing is kept."
                checked={c.enabled}
                disabled={busy}
                onChange={(enabled) => void save({ enabled })}
                testId="stripe-enabled"
              />
              <Toggle
                label="Mark testimonials from buyers as “Verified purchase”"
                hint="When a testimonial's email matches a purchase. The match uses a keyed hash; emails are never stored with purchases."
                checked={c.verifyPurchases}
                disabled={busy}
                onChange={(verifyPurchases) => void save({ verifyPurchases })}
                testId="stripe-verify"
              />
              <div className="row">
                {c.restrictedKeySet && (
                  <button type="button" className="ghost small" disabled={busy} onClick={() => void save({ restrictedKey: "" }, "The restricted key is removed. Thank-you coupons stop.")}>
                    Remove the restricted key
                  </button>
                )}
                <button
                  type="button"
                  className="ghost small danger"
                  disabled={busy}
                  onClick={() => void remove(url, "DELETE", "Disconnect Stripe? Its webhook address stops working and every recorded purchase is deleted.")}
                >
                  Disconnect
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel" data-testid="purchases">
        <div className="panel-head">
          <h2 style={{ fontSize: "var(--text-base)" }}>Recorded purchases</h2>
          <span className="muted small">{state.purchaseCount.toLocaleString()} kept</span>
        </div>
        <div className="panel-body stack">
          <p className="muted small">
            Exactly what&apos;s kept: the first name, a city or country, the product, the amount and the time. Never the email, the last name, the address or
            any card detail. They&apos;re deleted after {c?.retentionDays ?? 90} days.
          </p>
          {state.purchases.length === 0 ? (
            <EmptyState icon="inbox" title="No purchases yet" level={3} testId="purchases-empty">
              {c ? "They appear here as Stripe sends them." : "Connect Stripe first."}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data-table small">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Name</th>
                    <th>Place</th>
                    <th>Product</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {state.purchases.map((p) => (
                    <tr key={p.id} data-testid="purchase-row">
                      <td>{when(p.purchasedAt)}</td>
                      <td>{p.firstName ?? "—"}</td>
                      <td>{p.place ?? "—"}</td>
                      <td>{p.product ?? "—"}</td>
                      <td>{p.amount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {admin && state.purchaseCount > 0 && (
            <div className="row">
              <button
                type="button"
                className="ghost small danger"
                disabled={busy}
                onClick={() => void remove(`/api/admin/projects/${projectId}/purchases`, "DELETE", "Delete every recorded purchase now? “Verified purchase” marks stay.")}
              >
                Delete all purchases
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: "var(--text-base)" }}>Where they&apos;re used</h2>
        </div>
        <div className="panel-body stack small">
          <p>
            <strong>Sales popup.</strong> Make a widget with the Sales popup layout (<a href={`/admin/projects/${projectId}/widgets`}>Widgets</a>). It&apos;s off
            until you add one to your site.
          </p>
          <p>
            <strong>Thank-you coupons.</strong> In a form&apos;s Settings › Rewards, choose &ldquo;A single-use Stripe promotion code each&rdquo; and enter a
            coupon&apos;s ID. It needs the restricted key above.
          </p>
        </div>
      </section>
    </div>
  );
}
