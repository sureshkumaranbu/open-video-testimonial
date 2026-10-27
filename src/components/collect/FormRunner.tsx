"use client";

import "./runner.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fontFaceCss, formDesignStyle } from "@/lib/forms/design";
import {
  emptyAnswers,
  isQuestion,
  thankYouFor,
  validateStep,
  visiblePages,
  type Answers,
  type Prefill,
  type ThankYou as ThankYouContent,
} from "@/lib/forms/engine";
import { dirFor, fillLabel, type LabelKey, type Labels } from "@/lib/forms/labels";
import type { FormPage, PublicForm } from "@/lib/forms/schema";
import { createAnswerUploads } from "./answer-uploads";
import { ConsentStep } from "./ConsentBlock";
import { clearDraft, hasContent, loadDraft, restoreDraft, saveDraft, toDraft, type FormDraft } from "./draft";
import { AboutCompanyStep, AboutYouStep } from "./steps/AboutSteps";
import { QuestionStep } from "./steps/QuestionStep";
import { ReviewStep } from "./steps/ReviewStep";
import { FeedbackStep, RatingStep, WelcomeStep } from "./steps/SimpleSteps";
import type { RunnerFiles, StepCtx } from "./steps/types";
import { ThankYou } from "./ThankYou";

export type FormRunnerProps = {
  project: { slug: string; name: string };
  form: PublicForm;
  labels: Labels;
  /** The exact consent wording shown, and its stored version (null in the builder's preview). */
  consent: { versionId: string | null; text: string };
  prefill: Prefill;
  /** A personal request link's signed token (?r=). */
  requestToken?: string | null;
  logoUrl: string | null;
  /** The project's colour, for whatever the design leaves unset. */
  accent: string;
  limits: { maxVideoBytes: number; maxImageBytes: number };
  /** Inside the iframe embed: tell the host page our height and when it was sent. */
  embed?: boolean;
  /** The builder's live preview: no camera, nothing is sent, and `previewPage` (an index into form.pages) is shown. */
  preview?: boolean;
  previewPage?: number;
};

type Done = { withdrawUrl: string; thankYou: ThankYouContent };

/** Posts to the page embedding us; nothing private is ever in these messages. */
function tellHost(message: object) {
  if (typeof window !== "undefined" && window.parent !== window) window.parent.postMessage(message, "*");
}

/**
 * The step-by-step form (FORM-03): one page per screen with a progress bar
 * and Back, which keeps every answer. Recordings belong to answer-uploads
 * controllers, so stepping away never aborts an upload. Answers are kept as
 * a draft in this browser (FORM-14, ./draft.ts) and offered back on return.
 * The same component is the builder's preview (`preview`), so they can't
 * drift apart; the preview keeps no draft.
 */
export function FormRunner(props: FormRunnerProps) {
  const { project, form, labels: l, consent, prefill, preview = false, embed = false } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const steps = useMemo(() => visiblePages(form), [form]);
  const [state, setState] = useState<Answers>(() => emptyAnswers(form, prefill.person));
  const [files, setFiles] = useState<RunnerFiles>({ photo: null, logo: null, images: {} });
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [uploads] = useState(() =>
    createAnswerUploads(
      (key) => `/api/projects/${encodeURIComponent(project.slug)}/uploads?form=${encodeURIComponent(form.id)}&question=${encodeURIComponent(key)}`,
    ),
  );
  const doneRef = useRef(false);
  // A draft from an earlier visit, waiting for "Continue" or "Start over"; autosave starts once that's settled.
  const [resume, setResume] = useState<FormDraft | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const keepsDraft = !preview && form.status !== "paused";
  // Marks the page interactive (scripts loaded), for people's tools and tests alike.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // localStorage exists only in the browser, so the draft is read after the first render.
    if (keepsDraft) setResume(loadDraft(form.id));
    setDraftChecked(true);
    setReady(true);
  }, [keepsDraft, form.id]);
  useEffect(() => {
    if (!keepsDraft || !draftChecked || resume || done) return;
    if (hasContent(state, prefill.person)) saveDraft(form.id, toDraft(state, steps, step));
  }, [keepsDraft, draftChecked, resume, done, state, step, steps, form.id, prefill.person]);
  // Leaving the form without sending throws its uploads away.
  useEffect(() => () => {
    if (!doneRef.current) uploads.abortAll();
  }, [uploads]);

  const t = useCallback(
    (key: LabelKey, values: Record<string, string | number> = {}) => fillLabel(l[key], { project: project.name, ...values }),
    [l, project.name],
  );

  // The iframe embed grows and shrinks with the form.
  useEffect(() => {
    if (!embed || !rootRef.current || typeof ResizeObserver === "undefined") return;
    const root = rootRef.current;
    const post = () => tellHost({ type: "plaudit:form-resize", form: form.id, slug: form.slug, height: Math.ceil(root.scrollHeight) });
    const observer = new ResizeObserver(post);
    observer.observe(root);
    post();
    return () => observer.disconnect();
  }, [embed, form.id, form.slug]);

  // Escape inside the embed reaches only this frame: ask the host to close its popup.
  useEffect(() => {
    if (!embed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") tellHost({ type: "plaudit:form-close", form: form.id, slug: form.slug });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embed, form.id, form.slug]);

  // A new step: start at its top and move focus to its heading (not on first load).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (preview) return;
    headingRef.current?.focus();
    if (!embed) window.scrollTo({ top: 0 });
  }, [step, done, preview, embed]);

  const shown: FormPage | undefined = preview && props.previewPage !== undefined ? form.pages[props.previewPage] : steps[step];
  const atStep = shown ? steps.indexOf(shown) : -1;
  const isLast = atStep === steps.length - 1;

  const ctx: StepCtx = {
    state,
    update: (fn) => setState((s) => fn(s)),
    errors,
    labels: l,
    t,
    project,
    form,
    files,
    setFiles: (fn) => setFiles((f) => fn(f)),
    uploads,
    limits: props.limits,
    preview,
    locked: prefill.locked,
    goToPage: (i) => {
      const at = steps.indexOf(form.pages[i]);
      if (at >= 0) {
        setErrors({});
        setStep(at);
      }
    },
  };

  /** What they wrote first: copied or shared from the thank-you page. */
  const words = () => {
    for (const q of steps.filter(isQuestion)) {
      const a = state.answers[q.key];
      if (q.mode !== "video" && a?.text.trim() && !(q.mode === "video_text" && a.mode === "video")) return a.text;
    }
    return "";
  };

  async function send() {
    setSubmitting(true);
    setError(null);
    try {
      const answers: { key: string; text?: string; videoUpload?: string; videoUploadToken?: string }[] = [];
      for (const q of steps.filter(isQuestion)) {
        const a = state.answers[q.key];
        const video = q.mode === "video" || (q.mode === "video_text" && a?.mode === "video");
        if (video) {
          const take = uploads.get(q.key).take;
          // Usually already done: the video uploads while it records and while they answer the rest.
          if (take) {
            const { id, token } = await take.upload.finish();
            answers.push({ key: q.key, videoUpload: id, videoUploadToken: token });
          }
        } else if (a?.text.trim()) {
          answers.push({ key: q.key, text: a.text });
        }
      }
      const { name, email, title, company, phone, website, socials } = state.person;
      const payload = {
        ...(state.rating ? { rating: state.rating } : {}),
        answers,
        feedback: Object.entries(state.feedback).flatMap(([key, text]) => (text.trim() ? [{ key, text }] : [])),
        person: { name, email, title, company, phone, socials },
        authorWebsite: website,
        customFields: Object.fromEntries(Object.entries(state.custom).filter(([, v]) => v !== "" && v !== false)),
        hiddenFields: prefill.hidden,
        consent: state.consent,
        ...(consent.versionId ? { consentVersion: consent.versionId } : {}),
        ...(props.requestToken ? { requestToken: props.requestToken } : {}),
        language: form.language,
      };
      const body = new FormData();
      body.set("payload", JSON.stringify(payload));
      if (files.photo) body.set("avatar", files.photo);
      if (files.logo) body.set("companyLogo", files.logo);
      for (const [key, list] of Object.entries(files.images)) for (const f of list) body.append(`images:${key}`, f);
      if (honeypotRef.current?.value) body.set("website", honeypotRef.current.value);
      const res = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/forms/${encodeURIComponent(form.slug)}/submissions`, {
        method: "POST",
        body,
      });
      const reply = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(reply.error || l.errorSend);
      doneRef.current = true;
      clearDraft(form.id);
      setDone({ withdrawUrl: reply.withdrawUrl, thankYou: reply.thankYou ?? thankYouFor(form, state.rating) });
      if (embed) tellHost({ type: "plaudit:form-submitted", form: form.id, slug: form.slug });
    } catch (err) {
      setError((err as Error).message || l.errorSend);
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (!shown || preview) return;
    const problems = validateStep(shown, state, l);
    setErrors(problems);
    if (Object.keys(problems).length) {
      // The first problem gets focus, so keyboard and screen-reader users land on it.
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>("[aria-invalid='true'], [role='alert']")?.focus?.());
      return;
    }
    if (isLast) void send();
    else setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  /** The prompt's two answers; either way focus moves to the step's heading. */
  function settleDraft(keep: boolean) {
    if (resume && keep) {
      const restored = restoreDraft(resume, state, steps, prefill.locked);
      setState(restored.state);
      setStep(restored.step);
    } else {
      clearDraft(form.id);
    }
    setResume(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function back() {
    setErrors({});
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  const thankYouPage = form.pages.find((p) => p.type === "thank_you");
  const showThanks = done || (preview && shown?.type === "thank_you");

  let body: React.ReactNode;
  if (form.status === "paused" && !preview) {
    body = (
      <div className="fr-closed" data-testid="form-closed" role="status">
        <h1>{l.closedTitle}</h1>
        <p className="fr-sub">{form.settings.closedMessage.trim() || t("closedMessage")}</p>
      </div>
    );
  } else if (showThanks) {
    body = (
      <ThankYou
        content={done?.thankYou ?? thankYouFor(form, state.rating)}
        labels={l}
        projectName={project.name}
        words={done ? words() : thankYouPage?.type === "thank_you" && thankYouPage.copyText ? l.textPlaceholder : ""}
        social={done ? state.consent.scopes.includes("social") : true}
        withdrawUrl={done?.withdrawUrl ?? null}
      />
    );
  } else if (resume && !preview) {
    body = (
      <section className="fr-step fr-resume" data-testid="fr-resume" aria-labelledby="fr-resume-title">
        <h1 id="fr-resume-title">{l.draftFound}</h1>
        {resume.hadVideo && <p className="fr-sub">{l.draftVideoAgain}</p>}
        <div className="fr-nav">
          <button type="button" className="secondary" onClick={() => settleDraft(false)} data-testid="draft-start-over">
            {l.draftStartOver}
          </button>
          <button type="button" className="accent fr-primary fr-next" onClick={() => settleDraft(true)} data-testid="draft-resume">
            {l.draftResume}
          </button>
        </div>
      </section>
    );
  } else if (shown) {
    const stepBody = (() => {
      switch (shown.type) {
        case "rating":
          return <RatingStep page={shown} ctx={ctx} />;
        case "welcome":
          return <WelcomeStep page={shown} ctx={ctx} />;
        case "question":
          return <QuestionStep key={shown.key} page={shown} ctx={ctx} />;
        case "feedback":
          return <FeedbackStep page={shown} ctx={ctx} />;
        case "consent":
          return <ConsentStep page={shown} ctx={ctx} wording={consent.text} />;
        case "about_you":
          return <AboutYouStep page={shown} ctx={ctx} />;
        case "about_company":
          return <AboutCompanyStep page={shown} ctx={ctx} />;
        case "review":
          return <ReviewStep page={shown} ctx={ctx} />;
        default:
          return null;
      }
    })();
    body = (
      <form
        className="fr-step"
        data-testid="fr-step"
        data-step-type={shown.type}
        data-step-key={"key" in shown ? shown.key : undefined}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <div
          className="fr-progress"
          role="progressbar"
          aria-label={t("stepOf", { n: Math.max(atStep, 0) + 1, total: steps.length })}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={Math.max(atStep, 0) + 1}
          data-testid="fr-progress"
        >
          <span style={{ transform: `scaleX(${(Math.max(atStep, 0) + 1) / Math.max(steps.length, 1)})` }} />
        </div>
        <div ref={headingRef} tabIndex={-1} className="stack" style={{ gap: "var(--space-5)", outline: "none" }}>
          {stepBody}
        </div>
        {/* Honeypot for bots; hidden from people and assistive tech. */}
        <input ref={honeypotRef} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="fr-honeypot" />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="fr-nav">
          {atStep > 0 && (
            <button type="button" className="secondary" onClick={back} disabled={submitting}>
              {l.back}
            </button>
          )}
          {shown.type === "question" && !shown.required && !isLast && (
            <button type="button" className="ghost" onClick={() => setStep((s) => s + 1)} disabled={preview}>
              {l.skip}
            </button>
          )}
          <button type="submit" className="accent fr-primary fr-next" disabled={submitting || preview}>
            {submitting
              ? Object.keys(uploads.takes()).length
                ? l.finishingUpload
                : l.sending
              : isLast
                ? l.submit
                : shown.type === "welcome"
                  ? l.start
                  : l.next}
          </button>
        </div>
      </form>
    );
  }

  const logo = form.design.showLogo && (
    <div className="fr-head">
      {props.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="fr-logo" src={props.logoUrl} alt={project.name} />
      ) : (
        <>
          <span className="fr-mark" aria-hidden>
            {project.name.trim().charAt(0).toUpperCase()}
          </span>
          {project.name}
        </>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`fr-root ${embed ? "fr-embed" : preview ? "" : "fr-page"}`}
      lang={form.language}
      dir={dirFor(form.language)}
      data-theme={form.design.theme}
      data-button={form.design.buttonStyle}
      data-testid="form-runner"
      data-ready={ready || undefined}
      style={formDesignStyle(form.design, props.accent) as React.CSSProperties}
    >
      {fontFaceCss(form.design) && <style>{fontFaceCss(form.design)}</style>}
      <div className="fr-shell">
        {logo}
        {body}
      </div>
    </div>
  );
}
