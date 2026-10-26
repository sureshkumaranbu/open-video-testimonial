"use client";

import { useState } from "react";
import { api } from "@/app/admin/api";
import { copyText } from "@/components/admin/clipboard";
import { Icon } from "@/components/Icon";
import "@/app/admin/onboarding.css";

type StepId = "collect" | "widget" | "install" | "share";
type Step = { id: StepId; done: boolean; skipped: boolean };
type Checklist = { steps: Step[]; dismissed: boolean; complete: boolean; doneCount: number; shown: boolean };

/**
 * The Get started checklist (ONB-05) for a project made by the wizard. Steps
 * turn green from what happens in the project; "install" is the owner's own
 * tick until install detection arrives (DISP-13, P1). Each step can be
 * skipped, and the card can be dismissed once every step is done or skipped.
 */
export function GetStarted({ projectId, initial, formLink }: { projectId: string; initial: Checklist; formLink: string }) {
  const [list, setList] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!list.shown) return null;

  const send = async (body: object) => {
    setError(null);
    try {
      const r = await api<{ checklist: Checklist }>(`/api/admin/projects/${projectId}/checklist`, { method: "PATCH", json: body });
      setList(r.checklist);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const base = `/admin/projects/${projectId}`;
  const COPY: Record<StepId, { title: string; body: string; action: React.ReactNode }> = {
    collect: {
      title: "Import or collect testimonials",
      body: "Bring in reviews from Google, Trustpilot and others, or add one by hand.",
      action: (
        <a className="button secondary small" href={`${base}/data`}>
          Import testimonials
        </a>
      ),
    },
    widget: {
      title: "Customise a widget",
      body: "We made a grid and a carousel in your colours. Pick a layout and what to show.",
      action: (
        <a className="button secondary small" href={`${base}/widgets`}>
          Open widgets
        </a>
      ),
    },
    install: {
      title: "Add it to your site",
      body: "Paste the widget's snippet into your site, then tick this off.",
      action: (
        <button type="button" className="secondary small" onClick={() => void send({ step: "install", action: "done" })}>
          <Icon name="check" /> I&apos;ve added it
        </button>
      ),
    },
    share: {
      title: "Share your form link",
      body: "Send it to happy customers, or invite them by email from Requests.",
      action: (
        <button
          type="button"
          className="secondary small"
          onClick={async () => {
            if (await copyText(formLink)) setCopied(true);
            await send({ step: "share", action: "done" });
          }}
        >
          <Icon name="copy" /> {copied ? "Copied" : "Copy form link"}
        </button>
      ),
    },
  };

  return (
    <section className="panel ob-checklist" data-testid="get-started" aria-labelledby="gs-h">
      <div className="panel-head row spread">
        <h2 id="gs-h" style={{ fontSize: "var(--text-base)" }}>
          Get started
        </h2>
        <span className="muted small" data-testid="get-started-progress">
          {list.doneCount}/{list.steps.length} done
        </span>
      </div>
      <ol className="ob-steps panel-body">
        {list.steps.map((s, i) => {
          const c = COPY[s.id];
          return (
            <li key={s.id} className="ob-step" data-testid={`get-started-${s.id}`} data-done={s.done} data-skipped={s.skipped}>
              <span className="ob-step-mark" aria-hidden>
                {s.done ? <Icon name="check" /> : i + 1}
              </span>
              <div className="ob-step-body">
                <strong>
                  {c.title}
                  <span className="visually-hidden">{s.done ? " (done)" : s.skipped ? " (skipped)" : ""}</span>
                </strong>
                {!s.done && !s.skipped && <p className="muted xsmall">{c.body}</p>}
                {s.skipped && <p className="muted xsmall">Skipped</p>}
              </div>
              <div className="row ob-step-actions">
                {!s.done && !s.skipped && c.action}
                {!s.done && !s.skipped && (
                  <button type="button" className="ghost small" onClick={() => void send({ step: s.id, action: "skip" })} aria-label={`Skip: ${c.title}`}>
                    Skip
                  </button>
                )}
                {s.skipped && (
                  <button type="button" className="ghost small" onClick={() => void send({ step: s.id, action: "undo" })}>
                    Undo
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {error && (
        <p className="error panel-body" role="alert">
          {error}
        </p>
      )}
      {list.complete && (
        <div className="panel-body">
          <button type="button" className="ghost small" onClick={() => void send({ dismiss: true })}>
            Hide this list
          </button>
        </div>
      )}
    </section>
  );
}
