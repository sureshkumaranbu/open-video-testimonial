"use client";

import { answered, isQuestion } from "@/lib/forms/engine";
import type { FormPage } from "@/lib/forms/schema";
import type { StepCtx } from "./types";

/** "Check and send": every answer read-only, with an Edit link back to its step, and the consent chosen. */
export function ReviewStep({ page, ctx }: { page: Extract<FormPage, { type: "review" }>; ctx: StepCtx }) {
  const { state, labels: l, form } = ctx;
  const questions = form.pages.map((p, index) => ({ p, index })).filter(({ p }) => isQuestion(p) && p.enabled);
  return (
    <>
      <h1>{page.title || l.reviewTitle}</h1>
      <dl className="fr-review" data-testid="review">
        {questions.map(({ p, index }) => {
          if (!isQuestion(p)) return null;
          const a = state.answers[p.key];
          const video = a?.hasVideo && (p.mode === "video" || (p.mode === "video_text" && a.mode === "video"));
          return (
            <div key={p.key}>
              <dt>
                {p.title}
                <button type="button" className="ghost small" onClick={() => ctx.goToPage(index)} aria-label={`${l.reviewEdit}: ${p.title}`}>
                  {l.reviewEdit}
                </button>
              </dt>
              <dd>{!answered(p, a) ? l.reviewSkipped : video ? l.reviewVideo : a.text}</dd>
            </div>
          );
        })}
      </dl>
      <p className="fr-sub">{state.consent.public ? ctx.t("reviewPublic") : ctx.t("reviewPrivate")}</p>
    </>
  );
}
