"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Toggle } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { FormPage, LowRatingSettings } from "@/lib/forms/schema";
import { MAX_PRIZES, wheelTotal, type RewardConfig, type RewardKind, type RewardMode, type WheelPrize } from "@/lib/rewards-config";
import type { Claim, PoolStats } from "@/lib/rewards";

const MODE_NAMES: Record<RewardMode, string> = { none: "No reward", same: "The same for everyone", wheel: "Spin the wheel" };
const KIND_NAMES: Record<RewardKind, string> = {
  code: "One coupon code for everyone",
  url: "A link (a download, a booking page…)",
  pool: "A unique code each, from your list of codes",
  stripe: "A single-use Stripe promotion code each (from your coupon)",
};
const VIA: Record<Claim["via"], string> = { testimonial: "Testimonial", feedback: "Private feedback", recipient: "Campaign recipient", removed: "Deleted since" };

const newId = () => Math.random().toString(36).slice(2, 10);

/** The note every reward setting carries (FTC endorsement rules; Google's and Trustpilot's policies). */
export function RewardRulesNote() {
  return (
    <p className="notice small" data-testid="reward-rules">
      A reward thanks people for their time, so everyone who sends the form gets it, whatever they rate or say. Rules
      such as the FTC&apos;s and the review sites&apos; own policies forbid rewards that depend on a review being
      positive. People sent to private feedback by a low rating get it too, and your review booster pages never mention
      a reward.
    </p>
  );
}

/** FORM-13: the reward a form gives, and its pool of unique codes. */
export function RewardsEditor({
  formId,
  projectId,
  reward,
  onChange,
  classic,
  stripe = false,
}: {
  formId: string;
  projectId: string;
  reward: RewardConfig;
  onChange: (r: RewardConfig) => void;
  classic: boolean;
  /** INT-07 (commerce flag): offer "Stripe coupon". */
  stripe?: boolean;
}) {
  const set = (patch: Partial<RewardConfig>) => onChange({ ...reward, ...patch });
  const total = wheelTotal(reward.prizes);
  const setPrize = (i: number, patch: Partial<WheelPrize>) => set({ prizes: reward.prizes.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="stack" data-testid="rewards-editor">
      <h2 className="section-title">Rewards</h2>
      {classic ? (
        <p className="muted small">Rewards show on the thank-you step, which the classic page doesn&apos;t have. Switch the form to step by step to give one.</p>
      ) : (
        <>
          <label>
            Give people who send the form
            <select value={reward.mode} onChange={(e) => set({ mode: e.target.value as RewardMode })} data-testid="reward-mode">
              {(Object.keys(MODE_NAMES) as RewardMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_NAMES[m]}
                </option>
              ))}
            </select>
          </label>
          {reward.mode !== "none" && <RewardRulesNote />}
          {reward.mode === "same" && (
            <>
              <label>
                What they get
                <select value={reward.kind} onChange={(e) => set({ kind: e.target.value as RewardKind })} data-testid="reward-kind">
                  {(Object.keys(KIND_NAMES) as RewardKind[])
                    .filter((k) => k !== "stripe" || stripe || reward.kind === "stripe")
                    .map((k) => (
                    <option key={k} value={k}>
                      {KIND_NAMES[k]}
                    </option>
                  ))}
                </select>
              </label>
              {reward.kind === "code" && (
                <label>
                  Coupon code
                  <input type="text" value={reward.code} maxLength={100} onChange={(e) => set({ code: e.target.value })} placeholder="THANKYOU10" data-testid="reward-code-input" />
                </label>
              )}
              {reward.kind === "url" && (
                <label>
                  Link
                  <input type="url" value={reward.url} maxLength={2000} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" data-testid="reward-url-input" />
                </label>
              )}
              {reward.kind === "pool" && <CodePool formId={formId} />}
              {reward.kind === "stripe" && (
                <fieldset className="fb-fieldset" data-testid="reward-stripe">
                  <legend>Stripe coupon</legend>
                  <label>
                    Coupon ID
                    <input
                      type="text"
                      value={reward.stripeCoupon}
                      maxLength={100}
                      onChange={(e) => set({ stripeCoupon: e.target.value.trim() })}
                      placeholder="THANKYOU10"
                      data-testid="reward-stripe-coupon"
                    />
                    <span className="muted xsmall">In Stripe: Product catalogue → Coupons, then the coupon&apos;s ID. Each person gets their own code for it, usable once.</span>
                  </label>
                  <label>
                    Each code works for (days)
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={reward.stripeExpiresDays}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isInteger(n) && n >= 0 && n <= 365) set({ stripeExpiresDays: n });
                      }}
                      data-testid="reward-stripe-days"
                    />
                    <span className="muted xsmall">0 keeps each code until the coupon itself ends.</span>
                  </label>
                  <p className="muted xsmall">
                    The code is made when someone sends the form, with the restricted key on this project&apos;s{" "}
                    <a href={`/admin/projects/${projectId}/commerce`}>Commerce page</a>. That key needs only one permission: Promotion codes, Write. If Stripe
                    can&apos;t make the code, the person still sees the thank-you, and the reason is in the audit log.
                  </p>
                </fieldset>
              )}
            </>
          )}
          {reward.mode === "wheel" && (
            <fieldset className="fb-fieldset" data-testid="reward-prizes">
              <legend>Prizes</legend>
              <p className="muted xsmall">The wheel is spun on this server, so nobody can pick their prize. The chances must add up to 100%, and the wheel shows them.</p>
              {reward.prizes.map((p, i) => (
                <div key={p.id} className="fb-prize">
                  <label>
                    Prize {i + 1}
                    <input type="text" value={p.label} maxLength={60} onChange={(e) => setPrize(i, { label: e.target.value })} placeholder="10% off" />
                  </label>
                  <label>
                    Code
                    <input type="text" value={p.code} maxLength={100} placeholder="Optional" onChange={(e) => setPrize(i, { code: e.target.value })} />
                  </label>
                  <label>
                    Chance %
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={Number.isFinite(p.weight) ? p.weight : ""}
                      onChange={(e) => setPrize(i, { weight: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                  </label>
                  <button type="button" className="ghost small" aria-label={`Remove prize ${i + 1}`} onClick={() => set({ prizes: reward.prizes.filter((_, j) => j !== i) })}>
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
              <div className="row spread">
                {reward.prizes.length < MAX_PRIZES ? (
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => set({ prizes: [...reward.prizes, { id: newId(), label: "", code: "", weight: Math.max(0, Math.round((100 - total) * 100) / 100) }] })}
                  >
                    <Icon name="plus" />
                    Add a prize
                  </button>
                ) : (
                  <span />
                )}
                <span className={Math.abs(total - 100) > 0.01 ? "error small" : "muted small"} data-testid="reward-total" role="status">
                  Total {Math.round(total * 100) / 100}%{Math.abs(total - 100) > 0.01 ? ": must be 100%" : ""}
                </span>
              </div>
            </fieldset>
          )}
          {reward.mode !== "none" && (
            <>
              <label>
                Heading <span className="muted xsmall">(optional)</span>
                <input type="text" value={reward.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="A thank-you from {project}" />
              </label>
              <label>
                Message <span className="muted xsmall">(optional)</span>
                <textarea rows={2} value={reward.message} maxLength={500} onChange={(e) => set({ message: e.target.value })} placeholder="Use it at checkout before the end of the year." />
              </label>
              <Toggle
                label="Only for testimonials with a video"
                hint="People sent to private feedback by a low rating still get it, since they can't record one."
                checked={reward.onlyVideo}
                onChange={(onlyVideo) => set({ onlyVideo })}
                testId="reward-only-video"
              />
              <p className="muted xsmall">It shows on the thank-you page and in the receipt email (sent for personal request links).</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** FORM-13 unique codes: upload a CSV or paste a list, see what's left and who got which code. */
function CodePool({ formId }: { formId: string }) {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ stats: PoolStats; claims: Claim[] }>(`/api/admin/forms/${formId}/reward-codes`);
    setStats(r.stats);
    setClaims(r.claims);
  }, [formId]);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load]);

  async function add(body: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await api<{ added: number; duplicates: number; invalid: number; stats: PoolStats }>(`/api/admin/forms/${formId}/reward-codes`, { method: "POST", json: { text: body } });
      setStats(r.stats);
      setText("");
      setStatus(
        [`Added ${r.added} code${r.added === 1 ? "" : "s"}`, r.duplicates ? `${r.duplicates} already in the list` : "", r.invalid ? `${r.invalid} line${r.invalid === 1 ? "" : "s"} skipped` : ""]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeUnused() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ removed: number; stats: PoolStats }>(`/api/admin/forms/${formId}/reward-codes`, { method: "DELETE" });
      setStats(r.stats);
      setStatus(`Removed ${r.removed} unused code${r.removed === 1 ? "" : "s"}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="fb-fieldset" data-testid="reward-pool">
      <legend>Codes</legend>
      {stats && (
        <p className={stats.left ? "small" : "notice small"} data-testid="reward-pool-stats" role="status">
          {stats.total === 0
            ? "No codes yet. Until you add some, people see a note that the rewards have run out."
            : stats.left === 0
              ? `All ${stats.total} codes have been claimed. People now see a note that the rewards have run out: add more below.`
              : `${stats.left} of ${stats.total} codes left · ${stats.claimed} claimed`}
        </p>
      )}
      <label>
        Paste codes, one per line
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={"SPRING-4KD9\nSPRING-7QX2"} data-testid="reward-codes-text" />
      </label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="secondary small" disabled={busy || !text.trim()} onClick={() => add(text)} data-testid="reward-codes-add">
          {busy ? "Adding…" : "Add codes"}
        </button>
        <label className="button secondary small">
          <Icon name="upload" />
          Upload a CSV
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="visually-hidden"
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await add(await f.text());
            }}
          />
        </label>
        {stats && stats.left > 0 && (
          <button type="button" className="ghost small" disabled={busy} onClick={removeUnused}>
            Remove unused codes
          </button>
        )}
      </div>
      <p className="muted xsmall">The first column of a CSV is read; a “code” header row is skipped. Each code goes to one person only.</p>
      {status && <p className="small" role="status">{status}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {claims.length > 0 && (
        <details>
          <summary className="small">Claimed codes ({stats?.claimed ?? claims.length})</summary>
          <table className="fb-claims" data-testid="reward-claims">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Who</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.code}>
                  <td>
                    <code>{c.code}</code>
                  </td>
                  <td>
                    {c.who ?? "—"} <span className="muted xsmall">{VIA[c.via]}</span>
                  </td>
                  <td className="muted xsmall">{new Date(c.claimedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </fieldset>
  );
}

/** FORM-12: send low ratings to private feedback instead of the questions. Off by default. */
export function LowRatingEditor({
  value,
  onChange,
  pages,
  classic,
}: {
  value: LowRatingSettings;
  onChange: (v: LowRatingSettings) => void;
  pages: FormPage[];
  classic: boolean;
}) {
  const set = (patch: Partial<LowRatingSettings>) => onChange({ ...value, ...patch });
  const ratingOn = pages.some((p) => p.type === "rating" && p.enabled);
  return (
    <div className="stack" data-testid="low-rating-editor">
      <h2 className="section-title">Low ratings</h2>
      <Toggle
        label="Ask for private feedback after a low rating"
        hint="Instead of the questions, people who rate at or below the number you choose write to you privately. It's stored as feedback, never as a testimonial."
        checked={value.enabled}
        disabled={classic && !value.enabled}
        onChange={(enabled) => set({ enabled })}
        testId="low-rating-toggle"
      />
      <p className="notice small" data-testid="low-rating-notice">
        Don&apos;t use this to gate reviews for Google, Trustpilot or other review sites: their policies forbid it. It&apos;s
        fine for private testimonials. Your review booster pages never gate: everyone sees every link.
      </p>
      {classic && <p className="muted xsmall">The classic page has no steps to swap. Switch the form to step by step to use this.</p>}
      {value.enabled && (
        <>
          {!ratingOn && (
            <p className="notice warn small" role="status">
              The rating page is turned off, so nobody is asked for a rating and this never applies. Turn it on in Content.
            </p>
          )}
          <label>
            Ratings at or below
            <select value={value.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} data-testid="low-rating-threshold">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} star{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Heading <span className="muted xsmall">(empty: “We’re sorry it wasn’t better”)</span>
            <input type="text" value={value.title} maxLength={300} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label>
            Message <span className="muted xsmall">(optional)</span>
            <textarea rows={2} value={value.subtitle} maxLength={500} onChange={(e) => set({ subtitle: e.target.value })} placeholder="Tell us what went wrong. Only we see this." />
          </label>
          <label>
            Placeholder <span className="muted xsmall">(optional)</span>
            <input type="text" value={value.placeholder} maxLength={200} onChange={(e) => set({ placeholder: e.target.value })} />
          </label>
          <Toggle label="Offer name and email fields (optional for them)" checked={value.askContact} onChange={(askContact) => set({ askContact })} />
        </>
      )}
    </div>
  );
}
