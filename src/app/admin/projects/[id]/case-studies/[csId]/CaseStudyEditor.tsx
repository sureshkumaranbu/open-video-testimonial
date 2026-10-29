"use client";

import "@/app/admin/insights.css";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { ConfirmDialog, UnsavedGuard } from "@/components/admin";
import { CaseStudyView } from "@/components/CaseStudyView";
import { Icon } from "@/components/Icon";
import type { AdminCaseStudy, CaseStudyContent } from "@/lib/case-studies";
import { AI_HELP_URL } from "@/lib/insights/links";

const MAX_METRICS = 4;

/**
 * SHARE-04: the case study editor. The fields on the left, the page as
 * people will read it on the right, updated as you type. "Draft with AI"
 * (when AI is on for the project) fills the fields from the testimonial's
 * words; nothing is saved until Save. Publishing gives it a public page and
 * PDF while its testimonial is approved, not withdrawn and public.
 */
export function CaseStudyEditor({
  projectId,
  projectName,
  initial,
  avatarUrl,
  testimonialId,
  ai,
  canEdit,
}: {
  projectId: string;
  projectName: string;
  initial: AdminCaseStudy;
  avatarUrl: string | null;
  testimonialId: string;
  ai: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState<CaseStudyContent>(initial.content);
  const [aiDrafted, setAiDrafted] = useState(false);
  const [busy, setBusy] = useState<"save" | "draft" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = title !== saved.title || JSON.stringify(content) !== JSON.stringify(saved.content);
  const set = <K extends keyof CaseStudyContent>(k: K, v: CaseStudyContent[K]) => setContent((c) => ({ ...c, [k]: v }));

  async function save(status?: "draft" | "published") {
    setBusy(status ? "publish" : "save");
    setError(null);
    setNote(null);
    try {
      const { caseStudy } = await api<{ caseStudy: AdminCaseStudy }>(`/api/admin/case-studies/${saved.id}`, { method: "PUT", json: { title, content, status, aiDrafted } });
      setSaved(caseStudy);
      setTitle(caseStudy.title);
      setContent(caseStudy.content);
      setAiDrafted(false);
      setNote(status === "published" ? (caseStudy.publicUrl ? "Published." : "Published, but its testimonial isn't public, so there's no public page yet.") : status === "draft" ? "Unpublished: the page and PDF are gone." : "Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function draft() {
    setBusy("draft");
    setError(null);
    setNote(null);
    try {
      const { draft } = await api<{ draft: { title: string; content: CaseStudyContent; dropped: string[] } }>(`/api/admin/case-studies/${saved.id}/draft`, { method: "POST" });
      setTitle(draft.title);
      setContent(draft.content);
      setAiDrafted(true);
      setNote(`Drafted with AI. Check every line against the testimonial, then save.${draft.dropped.length ? ` Left out: ${draft.dropped.join("; ")}.` : ""}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    try {
      await api(`/api/admin/case-studies/${saved.id}`, { method: "DELETE" });
      router.push(`/admin/projects/${projectId}/case-studies`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const area = (k: "summary" | "challenge" | "solution" | "result" | "pullQuote", label: string, hint: string, rows = 4) => (
    <label>
      {label}
      <textarea value={content[k]} onChange={(e) => set(k, e.target.value)} rows={rows} maxLength={k === "summary" ? 500 : k === "pullQuote" ? 600 : 3000} placeholder={hint} readOnly={!canEdit} data-testid={`cs-${k}`} />
    </label>
  );

  return (
    <div className="stack-lg">
      <UnsavedGuard dirty={dirty} />
      <div className="page-head">
        <div>
          <h1>{saved.title}</h1>
          <p className="muted">
            {saved.publicUrl ? (
              <>
                Public at{" "}
                <a href={saved.publicUrl} target="_blank" rel="noopener" data-testid="cs-public-link">
                  {saved.publicUrl}
                </a>
              </>
            ) : saved.status === "published" ? (
              "Published, but its testimonial isn't approved with public consent, so it has no public page."
            ) : (
              "A draft: only your team can see it."
            )}
            {saved.aiDraftedAt && <> · Drafted with AI on {new Date(saved.aiDraftedAt).toLocaleDateString("en-GB")}</>}
          </p>
        </div>
        <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
          <a className="button secondary small" href={`/api/admin/case-studies/${saved.id}/pdf`} data-testid="cs-download-pdf">
            <Icon name="download" />
            Download PDF
          </a>
          <a className="button ghost small" href={`/admin/projects/${projectId}?open=${testimonialId}`}>
            The testimonial
          </a>
        </div>
      </div>
      <div className="cs-layout">
        <form
          className="panel panel-body stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {canEdit && (
            <div className="ocr-box" data-testid="cs-ai-box">
              {ai ? (
                <>
                  <button type="button" className="secondary small" onClick={() => void draft()} disabled={busy !== null} data-testid="cs-draft-ai">
                    <Icon name="sparkle" />
                    {busy === "draft" ? "Drafting…" : "Draft with AI"}
                  </button>
                  <span className="muted small">Sends this testimonial&apos;s words (not the person&apos;s email or private fields) to your AI provider. It replaces the fields below.</span>
                </>
              ) : (
                <span className="muted small" data-testid="cs-ai-off">
                  Fill in the template yourself. Drafting with AI needs an AI provider on this server and AI on for this project (
                  <a href={AI_HELP_URL} target="_blank" rel="noopener">
                    how to set it up
                  </a>
                  ).
                </span>
              )}
            </div>
          )}
          <label>
            Title
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required readOnly={!canEdit} data-testid="cs-title" />
          </label>
          {area("summary", "Summary", "One or two sentences: who they are and what changed.", 2)}
          {area("challenge", "The challenge", "What wasn't working before? What did it cost them?")}
          {area("solution", "The solution", `How did they use ${projectName}? What did they set up?`)}
          {area("result", "The result", "What changed, in their words and in numbers?")}
          {area("pullQuote", "Pull quote", "Their own words, copied from the testimonial.", 3)}
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ fontWeight: 600 }}>
              Metrics (up to {MAX_METRICS})
            </legend>
            {content.metrics.map((m, i) => (
              <div className="cs-metric-row" key={i}>
                <label>
                  Number
                  <input type="text" value={m.value} maxLength={24} onChange={(e) => set("metrics", content.metrics.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="40%" readOnly={!canEdit} data-testid={`cs-metric-value-${i}`} />
                </label>
                <label>
                  What it measures
                  <input type="text" value={m.label} maxLength={80} onChange={(e) => set("metrics", content.metrics.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="less time on support" readOnly={!canEdit} data-testid={`cs-metric-label-${i}`} />
                </label>
                {canEdit && (
                  <button type="button" className="ghost small" onClick={() => set("metrics", content.metrics.filter((_, j) => j !== i))} aria-label={`Remove metric ${i + 1}`}>
                    <Icon name="trash" />
                  </button>
                )}
              </div>
            ))}
            {canEdit && content.metrics.length < MAX_METRICS && (
              <div>
                <button type="button" className="ghost small" onClick={() => set("metrics", [...content.metrics, { value: "", label: "" }])} data-testid="cs-add-metric">
                  <Icon name="plus" />
                  Add a metric
                </button>
              </div>
            )}
          </fieldset>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          {note && (
            <p className="small" role="status" data-testid="cs-note">
              {note}
            </p>
          )}
          {canEdit && (
            <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
              <button type="submit" disabled={busy !== null || content.metrics.some((m) => !m.value.trim() || !m.label.trim())} data-testid="cs-save">
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              {saved.status === "published" ? (
                <button type="button" className="secondary" onClick={() => void save("draft")} disabled={busy !== null} data-testid="cs-unpublish">
                  Unpublish
                </button>
              ) : (
                <button type="button" className="secondary" onClick={() => void save("published")} disabled={busy !== null || !saved.canBePublic} title={saved.canBePublic ? undefined : "Approve the testimonial (with public consent) first"} data-testid="cs-publish">
                  <Icon name="globe" />
                  {busy === "publish" ? "Publishing…" : "Save and publish"}
                </button>
              )}
              <button type="button" className="danger ghost" onClick={() => setConfirmDelete(true)} data-testid="cs-delete">
                Delete
              </button>
            </div>
          )}
        </form>
        <aside className="panel panel-body cs-preview" aria-label="Preview" data-testid="cs-preview">
          <CaseStudyView
            title={title}
            content={{ ...content, metrics: content.metrics.filter((m) => m.value.trim() && m.label.trim()) }}
            person={{ name: saved.person?.name ?? "Customer", title: saved.person?.title ?? null, company: saved.person?.company ?? null, avatarUrl }}
            projectName={projectName}
            headingLevel={2}
          />
        </aside>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this case study?"
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
        testId="cs-delete-confirm"
      >
        Its public page and PDF stop working. The testimonial stays.
      </ConfirmDialog>
    </div>
  );
}
