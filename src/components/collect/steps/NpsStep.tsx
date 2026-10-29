"use client";

import { promoterOffer } from "@/lib/forms/engine";
import type { NpsPage } from "@/lib/forms/schema";
import type { StepCtx } from "./types";

/**
 * NPS-01: 0–10 as a row of buttons (a labelled group, each with
 * aria-pressed, like the NPS custom field), then the optional "why". In a
 * survey, a promoter (9–10) is asked whether they'd also write a short
 * testimonial; only a yes adds the testimonial step (engine.visiblePages).
 */
export function NpsStep({ page, ctx }: { page: NpsPage; ctx: StepCtx }) {
  const { state, update, errors, labels: l } = ctx;
  const a = state.nps[page.key] ?? { score: null, why: "" };
  const error = errors[`n:${page.key}`];
  const errorId = error ? `nps-${page.key}-error` : undefined;
  const set = (patch: Partial<typeof a>) => update((s) => ({ ...s, nps: { ...s.nps, [page.key]: { ...a, ...patch } } }));
  const offered = promoterOffer(ctx.form, { [page.key]: a });
  return (
    <>
      <h1 id={`nps-${page.key}-title`}>
        {page.title} {!page.required && <span className="fr-optional">{l.optional}</span>}
      </h1>
      {page.subtitle && <p className="fr-sub">{page.subtitle}</p>}
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }} aria-describedby={errorId} data-testid={`nps-${page.key}`}>
        <legend className="visually-hidden">{l.npsScoreLabel}</legend>
        <div className="fr-nps" role="group" aria-labelledby={`nps-${page.key}-title`}>
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              aria-pressed={a.score === n}
              aria-invalid={error && n === 0 ? true : undefined}
              onClick={() => set({ score: a.score === n ? null : n })}
              data-testid={`nps-score-${n}`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="fr-nps-ends" aria-hidden>
          <span>{l.npsLow}</span>
          <span>{l.npsHigh}</span>
        </div>
        {error && (
          <p className="fr-error" id={errorId} role="alert">
            {error}
          </p>
        )}
      </fieldset>
      {a.score !== null && (
        <label>
          {page.whyTitle || l.npsWhy} <span className="fr-optional">{l.optional}</span>
          <textarea value={a.why} maxLength={2000} rows={3} placeholder={page.whyPlaceholder} onChange={(e) => set({ why: e.target.value })} data-testid={`nps-why-${page.key}`} />
        </label>
      )}
      {offered && (
        <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }} data-testid="nps-offer">
          <legend style={{ padding: 0, marginBottom: 6, fontWeight: 600 }}>{page.offerTitle || ctx.t("npsOfferTitle")}</legend>
          <label className="check">
            <input type="radio" name={`nps-offer-${page.key}`} checked={state.optIn} onChange={() => update((s) => ({ ...s, optIn: true }))} data-testid="nps-offer-yes" />
            {l.npsOfferYes}
          </label>
          <label className="check">
            <input type="radio" name={`nps-offer-${page.key}`} checked={!state.optIn} onChange={() => update((s) => ({ ...s, optIn: false }))} data-testid="nps-offer-no" />
            {l.npsOfferNo}
          </label>
        </fieldset>
      )}
    </>
  );
}
