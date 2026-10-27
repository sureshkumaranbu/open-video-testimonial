"use client";

import type { FormPage } from "@/lib/forms/schema";
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

export function WelcomeStep({ page, ctx }: { page: Page<"welcome">; ctx: StepCtx }) {
  return (
    <>
      <h1>{page.title || ctx.t("welcomeTitle")}</h1>
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
