"use client";

import type { FormPage } from "@/lib/forms/schema";
import type { StepCtx } from "./steps/types";

type Page<T extends FormPage["type"]> = Extract<FormPage, { type: T }>;

/** The consent page (FORM-10, D11, D12): the form's wording, the optional extra uses, and "keep it private" when offered. */
export function ConsentStep({ page, ctx, wording }: { page: Page<"consent">; ctx: StepCtx; wording: string }) {
  const { state, update, errors, labels: l } = ctx;
  const scopeLabel = { website: "", social: l.scopeSocial, ads: l.scopeAds, name: l.scopeName, face: l.scopeFace };
  const extras = page.scopes.filter((s) => s !== "website");
  const setConsent = (c: Partial<typeof state.consent>) => update((s) => ({ ...s, consent: { ...s.consent, ...c } }));
  const scopeBoxes = state.consent.public && extras.length > 0 && (
    <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
      <legend style={{ padding: 0, marginBottom: 6 }}>
        {l.consentExtras} <span className="fr-optional">{l.optional}</span>
      </legend>
      {extras.map((scope) => (
        <label key={scope} className="check">
          <input
            type="checkbox"
            checked={state.consent.scopes.includes(scope)}
            onChange={(e) =>
              setConsent({
                scopes: e.target.checked ? [...state.consent.scopes, scope] : state.consent.scopes.filter((x) => x !== scope),
              })
            }
          />
          {scopeLabel[scope]}
        </label>
      ))}
    </fieldset>
  );
  return (
    <>
      <h1>{ctx.t("consentTitle")}</h1>
      {page.allowPrivate ? (
        <div className="fr-choices" role="radiogroup" aria-label={ctx.t("consentTitle")}>
          <label className="fr-choice">
            <input
              type="radio"
              name="fr-consent"
              checked={state.consent.agreed && state.consent.public}
              onChange={() => setConsent({ agreed: true, public: true })}
            />
            <span className="stack" style={{ gap: 4 }}>
              <strong>{ctx.t("consentPublic")}</strong>
              <span data-testid="consent-text">{wording}</span>
            </span>
          </label>
          <label className="fr-choice">
            <input
              type="radio"
              name="fr-consent"
              checked={state.consent.agreed && !state.consent.public}
              onChange={() => setConsent({ agreed: true, public: false, scopes: [] })}
            />
            <strong>{ctx.t("consentPrivate")}</strong>
          </label>
        </div>
      ) : (
        <label className="check consent">
          <input type="checkbox" checked={state.consent.agreed} onChange={(e) => setConsent({ agreed: e.target.checked, public: true })} />
          <span data-testid="consent-text">{wording}</span>
        </label>
      )}
      {scopeBoxes}
      {errors.consent && (
        <p className="fr-error" role="alert">
          {errors.consent}
        </p>
      )}
    </>
  );
}
