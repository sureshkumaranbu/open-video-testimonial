"use client";

import type { PersonKey, SocialKey } from "@/lib/forms/engine";
import { SOCIAL_KEYS } from "@/lib/forms/engine";
import type { LabelKey } from "@/lib/forms/labels";
import type { FormPage } from "@/lib/forms/schema";
import { CustomField } from "../fields/CustomField";
import { PhotoPicker } from "../PhotoPicker";
import type { StepCtx } from "./types";

type Page<T extends FormPage["type"]> = Extract<FormPage, { type: T }>;

const SOCIAL_LABELS: Record<SocialKey, LabelKey> = {
  x: "socialX",
  linkedin: "socialLinkedin",
  instagram: "socialInstagram",
  tiktok: "socialTiktok",
};

function Detail({
  ctx,
  k,
  label,
  hint,
  type = "text",
  required,
  autoComplete,
}: {
  ctx: StepCtx;
  k: PersonKey;
  label: string;
  hint?: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  const error = ctx.errors[k];
  const locked = ctx.locked.includes(k);
  return (
    <label>
      <span>
        {label} {hint ? <span className="hint">{hint}</span> : !required && <span className="fr-optional">{ctx.labels.optional}</span>}
      </span>
      <input
        type={type}
        value={ctx.state.person[k]}
        readOnly={locked}
        required={required}
        autoComplete={autoComplete}
        maxLength={k === "website" ? 2000 : k === "email" ? 254 : 120}
        aria-invalid={Boolean(error)}
        onChange={(e) => {
          const v = e.target.value;
          ctx.update((s) => ({ ...s, person: { ...s.person, [k]: v } }));
        }}
      />
      {error && (
        <span className="fr-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

function CustomFields({ fields, ctx }: { fields: Page<"about_you">["custom"]; ctx: StepCtx }) {
  return (
    <>
      {fields.map((f) => (
        <CustomField
          key={f.key}
          field={f}
          labels={ctx.labels}
          value={ctx.state.custom[f.key]}
          error={ctx.errors[`c:${f.key}`]}
          onChange={(v) => ctx.update((s) => ({ ...s, custom: { ...s.custom, [f.key]: v } }))}
        />
      ))}
    </>
  );
}

/** About you: the name always, then whichever details the form asks for, then its custom fields. */
export function AboutYouStep({ page, ctx }: { page: Page<"about_you">; ctx: StepCtx }) {
  const { labels: l } = ctx;
  const f = page.fields;
  return (
    <>
      <h1>{l.aboutYouTitle}</h1>
      <div className="fr-fields">
        <Detail ctx={ctx} k="name" label={l.name} required autoComplete="name" />
        {f.email.enabled && <Detail ctx={ctx} k="email" label={l.email} type="email" hint={l.emailHint} required={f.email.required} autoComplete="email" />}
        {(f.title.enabled || f.company.enabled) && (
          <div className="fr-fields two">
            {f.title.enabled && <Detail ctx={ctx} k="title" label={l.jobTitle} required={f.title.required} autoComplete="organization-title" />}
            {f.company.enabled && <Detail ctx={ctx} k="company" label={l.company} required={f.company.required} autoComplete="organization" />}
          </div>
        )}
        {f.website.enabled && <Detail ctx={ctx} k="website" label={l.website} type="url" required={f.website.required} autoComplete="url" />}
        {f.phone.enabled && <Detail ctx={ctx} k="phone" label={l.phone} type="tel" hint={l.phoneHint} required={f.phone.required} autoComplete="tel" />}
        {f.photo.enabled && (
          <div className="stack" style={{ gap: 4 }}>
            <PhotoPicker
              maxBytes={ctx.limits.maxImageBytes}
              required={f.photo.required}
              file={ctx.files.photo}
              onChange={(file) => {
                ctx.setFiles((x) => ({ ...x, photo: file }));
                ctx.update((s) => ({ ...s, hasPhoto: Boolean(file) }));
              }}
              labels={{
                label: l.photo,
                optional: l.optional,
                hint: l.photoHint,
                change: l.photoChange,
                tooLarge: l.fileTooLarge,
                unsupported: l.photoUnsupported,
              }}
            />
            {ctx.errors.photo && (
              <span className="fr-error" role="alert">
                {ctx.errors.photo}
              </span>
            )}
          </div>
        )}
        {f.socials.enabled && (
          <fieldset className="fr-fields two" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ padding: 0, marginBottom: 6 }}>
              {l.socials} {!f.socials.required && <span className="fr-optional">{l.optional}</span>}
            </legend>
            {SOCIAL_KEYS.map((k) => (
              <label key={k}>
                {l[SOCIAL_LABELS[k]]}
                <input
                  type="text"
                  maxLength={100}
                  value={ctx.state.person.socials[k] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    ctx.update((s) => ({ ...s, person: { ...s.person, socials: { ...s.person.socials, [k]: v } } }));
                  }}
                />
              </label>
            ))}
            {ctx.errors.socials && (
              <span className="fr-error" role="alert">
                {ctx.errors.socials}
              </span>
            )}
          </fieldset>
        )}
        <CustomFields fields={page.custom} ctx={ctx} />
      </div>
    </>
  );
}

/** About your company (B2B forms): company, its site and logo, and custom fields. */
export function AboutCompanyStep({ page, ctx }: { page: Page<"about_company">; ctx: StepCtx }) {
  const { labels: l } = ctx;
  const f = page.fields;
  return (
    <>
      <h1>{l.aboutCompanyTitle}</h1>
      <div className="fr-fields">
        {f.company.enabled && <Detail ctx={ctx} k="company" label={l.company} required={f.company.required} autoComplete="organization" />}
        {f.website.enabled && <Detail ctx={ctx} k="website" label={l.companyWebsite} type="url" required={f.website.required} autoComplete="url" />}
        {f.logo.enabled && (
          <div className="stack" style={{ gap: 4 }}>
            <PhotoPicker
              maxBytes={ctx.limits.maxImageBytes}
              required={f.logo.required}
              file={ctx.files.logo}
              testId="company-logo"
              onChange={(file) => {
                ctx.setFiles((x) => ({ ...x, logo: file }));
                ctx.update((s) => ({ ...s, hasLogo: Boolean(file) }));
              }}
              labels={{
                label: l.companyLogo,
                optional: l.optional,
                hint: l.logoHint,
                change: l.photoChange,
                tooLarge: l.fileTooLarge,
                unsupported: l.photoUnsupported,
              }}
            />
            {ctx.errors.logo && (
              <span className="fr-error" role="alert">
                {ctx.errors.logo}
              </span>
            )}
          </div>
        )}
        <CustomFields fields={page.custom} ctx={ctx} />
      </div>
    </>
  );
}
