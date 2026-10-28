"use client";

import type { FormPage } from "@/lib/forms/schema";
import type { OwnerVideo as OwnerVideoData } from "@/lib/video/form-videos";
import { OwnerVideo } from "../OwnerVideo";
import { StarInput } from "../StarInput";
import type { StepCtx } from "./types";

type Page<T extends FormPage["type"]> = Extract<FormPage, { type: T }>;

export function RatingStep({ page, ctx }: { page: Page<"rating">; ctx: StepCtx }) {
  const { labels: l, state, update, errors } = ctx;
  return (
    <>
      <h1>{page.title || ctx.t("ratingTitle")}</h1>
      {page.subtitle && <p className="fr-sub">{page.subtitle}</p>}
      <StarInput
        value={state.rating}
        onChange={(rating) => update((s) => ({ ...s, rating }))}
        label={l.ratingLabel}
        words={["", l.ratingWord1, l.ratingWord2, l.ratingWord3, l.ratingWord4, l.ratingWord5]}
        starLabel={(n) => (n === 1 ? l.starOne : ctx.t("starMany", { n }))}
      />
      {errors.rating && (
        <p className="fr-error" role="alert">
          {errors.rating}
        </p>
      )}
    </>
  );
}

export function WelcomeStep({ page, ctx, video }: { page: Page<"welcome">; ctx: StepCtx; video?: OwnerVideoData }) {
  return (
    <>
      <h1>{page.title || ctx.t("welcomeTitle")}</h1>
      {video && <OwnerVideo video={video} label={page.title || ctx.t("welcomeTitle")} />}
      <p className="fr-sub">{page.message || ctx.t("welcomeMessage")}</p>
      {page.bullets.length > 0 && (
        <ul className="fr-bullets">
          {page.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function FeedbackStep({ page, ctx }: { page: Page<"feedback">; ctx: StepCtx }) {
  const { state, update, errors } = ctx;
  const error = errors[`f:${page.key}`];
  return (
    <>
      <h1>
        {page.title} {!page.required && <span className="fr-optional">{ctx.labels.optional}</span>}
      </h1>
      {page.subtitle && <p className="fr-sub">{page.subtitle}</p>}
      <label>
        <span className="visually-hidden">{page.title}</span>
        <textarea
          value={state.feedback[page.key] ?? ""}
          maxLength={5000}
          placeholder={page.placeholder || ctx.labels.feedbackPlaceholder}
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            const text = e.target.value;
            update((s) => ({ ...s, feedback: { ...s.feedback, [page.key]: text } }));
          }}
        />
      </label>
      <p className="fr-sub small">{ctx.t("feedbackPrivate")}</p>
      {error && (
        <p className="fr-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * FORM-12: what a low rating shows instead of the questions. Private
 * feedback, plus an optional name and email so the owner can reply; it's
 * stored as feedback, never as a testimonial.
 */
export function LowRatingStep({ page, ctx, askContact }: { page: Page<"feedback">; ctx: StepCtx; askContact: boolean }) {
  const { state, update, errors, labels: l } = ctx;
  const error = errors[`f:${page.key}`];
  return (
    <>
      <h1>{page.title || l.lowRatingTitle}</h1>
      <p className="fr-sub">{page.subtitle || ctx.t("lowRatingSubtitle")}</p>
      <label>
        <span className="visually-hidden">{page.title || l.lowRatingTitle}</span>
        <textarea
          value={state.feedback[page.key] ?? ""}
          maxLength={5000}
          placeholder={page.placeholder || l.feedbackPlaceholder}
          aria-invalid={Boolean(error)}
          data-testid="low-rating-text"
          onChange={(e) => {
            const text = e.target.value;
            update((s) => ({ ...s, feedback: { ...s.feedback, [page.key]: text } }));
          }}
        />
      </label>
      {error && (
        <p className="fr-error" role="alert">
          {error}
        </p>
      )}
      {askContact && (
        <fieldset className="fr-fields" data-testid="low-rating-contact">
          <legend className="fr-sub small">{l.lowRatingContact}</legend>
          <label>
            {l.lowRatingName}
            <input
              type="text"
              autoComplete="name"
              maxLength={120}
              value={state.person.name}
              readOnly={ctx.locked.includes("name")}
              onChange={(e) => {
                const name = e.target.value;
                update((s) => ({ ...s, person: { ...s.person, name } }));
              }}
            />
          </label>
          <label>
            {l.email}
            <input
              type="email"
              autoComplete="email"
              maxLength={254}
              value={state.person.email}
              readOnly={ctx.locked.includes("email")}
              aria-invalid={Boolean(errors.email)}
              onChange={(e) => {
                const email = e.target.value;
                update((s) => ({ ...s, person: { ...s.person, email } }));
              }}
            />
          </label>
          {errors.email && (
            <p className="fr-error" role="alert">
              {errors.email}
            </p>
          )}
        </fieldset>
      )}
    </>
  );
}
