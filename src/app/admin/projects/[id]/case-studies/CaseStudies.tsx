"use client";

import "@/app/admin/insights.css";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { EmptyState } from "@/components/admin";
import { Icon } from "@/components/Icon";
import type { AdminCaseStudy } from "@/lib/case-studies";

type Candidate = { id: string; name: string; company: string | null; status: string; words: string };

/**
 * SHARE-04: the list of case studies and "New case study" from a
 * testimonial. A new one starts from the template; the editor then offers
 * "Draft with AI" when AI is on for the project.
 */
export function CaseStudies({ projectId, initial, candidates, from, ai, canEdit }: { projectId: string; initial: AdminCaseStudy[]; candidates: Candidate[]; from?: string; ai: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState(from && candidates.some((c) => c.id === from) ? from : (candidates[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const { caseStudy } = await api<{ caseStudy: AdminCaseStudy }>(`/api/admin/projects/${projectId}/case-studies`, { method: "POST", json: { testimonialId: pick } });
      router.push(`/admin/projects/${projectId}/case-studies/${caseStudy.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      {canEdit && (
        <section className="panel" aria-labelledby="cs-new-h">
          <div className="panel-head">
            <h2 id="cs-new-h">New case study</h2>
          </div>
          <form className="panel-body stack" onSubmit={create}>
            {candidates.length ? (
              <>
                <label>
                  From the testimonial
                  <select value={pick} onChange={(e) => setPick(e.target.value)} data-testid="cs-testimonial">
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {[c.name, c.company].filter(Boolean).join(", ")}
                        {c.words ? ` · ${c.words.slice(0, 60)}` : ""}
                        {c.status !== "approved" ? ` (${c.status})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small">
                  {ai
                    ? "It starts as a template. In the editor, Draft with AI can fill it in from the testimonial's words."
                    : "It starts as a template for you to fill in. With an AI provider set up, the editor can draft it for you (docs/help/insights.md)."}{" "}
                  Only approved testimonials with public consent can have a public page.
                </p>
                <div>
                  <button type="submit" disabled={busy || !pick} data-testid="cs-create">
                    <Icon name="plus" />
                    {busy ? "Making…" : "Make a case study"}
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">Add or collect a testimonial first; a case study is made from one.</p>
            )}
            {error && (
              <p className="error small" role="alert">
                {error}
              </p>
            )}
          </form>
        </section>
      )}
      {initial.length ? (
        <ul className="cs-list" data-testid="cs-list">
          {initial.map((cs) => (
            <li key={cs.id}>
              <span className="stack" style={{ gap: 2 }}>
                <a href={`/admin/projects/${projectId}/case-studies/${cs.id}`}>
                  <strong>{cs.title}</strong>
                </a>
                <span className="muted small">
                  {cs.person ? [cs.person.name, cs.person.company].filter(Boolean).join(", ") : "Testimonial deleted"} · updated {new Date(cs.updatedAt).toLocaleDateString("en-GB")}
                </span>
              </span>
              <span className="cs-badge" data-status={cs.publicUrl ? "published" : "draft"}>
                {cs.publicUrl ? "Published" : cs.status === "published" ? "Published, not public" : "Draft"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="pen" title="No case studies yet" testId="cs-empty">
          Pick a testimonial above to make the first one, or use Case study in a testimonial&apos;s drawer.
        </EmptyState>
      )}
    </div>
  );
}
