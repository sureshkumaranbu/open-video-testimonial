"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Icon } from "@/components/Icon";
import { AI_HELP_URL } from "@/lib/insights/links";
import type { FormRow } from "./types";

const MAX_QUESTIONS = 5;

/**
 * NPS-01: a new survey. Everyone answers its NPS question and private
 * questions; only promoters who say yes go on to write a testimonial. With
 * AI on for the project, "Draft with AI" turns a goal into the NPS wording
 * and questions, which stay editable here and in the builder; the survey is
 * made paused, to be published once checked.
 */
export function NewSurvey({ projectId, ai }: { projectId: string; ai: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [npsTitle, setNpsTitle] = useState("");
  const [questions, setQuestions] = useState("");
  const [busy, setBusy] = useState<"draft" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafted, setDrafted] = useState(false);
  const list = questions.split("\n").map((q) => q.trim()).filter(Boolean);

  async function draft() {
    setBusy("draft");
    setError(null);
    try {
      const { draft: d } = await api<{ draft: { name: string; npsTitle: string | null; questions: string[] } }>(`/api/admin/projects/${projectId}/survey-draft`, { method: "POST", json: { goal } });
      if (!name.trim()) setName(d.name);
      if (d.npsTitle) setNpsTitle(d.npsTitle);
      setQuestions(d.questions.join("\n"));
      setDrafted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const { form } = await api<{ form: FormRow }>(`/api/admin/projects/${projectId}/forms`, {
        method: "POST",
        json: { name, kind: "survey", survey: { ...(npsTitle.trim() ? { npsTitle: npsTitle.trim() } : {}), questions: list.slice(0, MAX_QUESTIONS) } },
      });
      router.push(`/admin/projects/${projectId}/forms/${form.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <details className="panel" data-testid="new-survey">
      <summary className="panel-body" style={{ cursor: "pointer", fontWeight: 600 }}>
        New survey (NPS)
      </summary>
      <form className="panel-body stack" onSubmit={create}>
        <p className="muted small">
          Ask how likely people are to recommend you and why, plus a few questions of your own. Answers stay private (Insights → NPS). Promoters (9–10) are
          offered the testimonial step; only those who say yes become testimonials.
        </p>
        <label>
          Survey name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Quarterly customer survey" data-testid="survey-name" />
        </label>
        {ai ? (
          <div className="stack" style={{ gap: "var(--space-2)" }}>
            <label>
              What do you want to learn? (for Draft with AI)
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={1000} rows={2} placeholder="Why trial users don't upgrade" data-testid="survey-goal" />
            </label>
            <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className="secondary small" onClick={() => void draft()} disabled={busy !== null || goal.trim().length < 3} data-testid="survey-draft-ai">
                <Icon name="sparkle" />
                {busy === "draft" ? "Drafting…" : "Draft with AI"}
              </button>
              <span className="muted small">Only this goal and your project&apos;s name are sent to your AI provider.</span>
            </div>
          </div>
        ) : (
          <p className="muted small" data-testid="survey-ai-off">
            Write the questions yourself, or{" "}
            <a href={AI_HELP_URL} target="_blank" rel="noopener">
              set up an AI provider
            </a>{" "}
            to draft them from a goal.
          </p>
        )}
        <label>
          NPS question
          <input type="text" value={npsTitle} onChange={(e) => setNpsTitle(e.target.value)} maxLength={300} placeholder="How likely are you to recommend us to a friend or colleague?" data-testid="survey-nps-title" />
        </label>
        <label>
          Your questions, one per line (up to {MAX_QUESTIONS}; private answers)
          <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={4} maxLength={1600} placeholder="What's one thing we could do better?" data-testid="survey-questions" />
        </label>
        {drafted && (
          <p className="small" role="status" data-testid="survey-drafted">
            Drafted with AI. Change anything you like; the survey starts paused so you can check it in the builder before publishing.
          </p>
        )}
        {list.length > MAX_QUESTIONS && <p className="error small">Only the first {MAX_QUESTIONS} questions are kept.</p>}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className="accent" disabled={busy !== null || !name.trim()} data-testid="survey-create">
            <Icon name="plus" />
            {busy === "create" ? "Making…" : "Make the survey"}
          </button>
        </div>
      </form>
    </details>
  );
}
