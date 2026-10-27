"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Modal, SearchField } from "@/components/admin";

export type MergeCandidate = { id: string; authorName: string; authorEmail?: string | null; text: string | null; status: string; createdAt: string };

const STATUS: Record<string, string> = { pending: "Pending", approved: "Approved", hidden: "Hidden", rejected: "Rejected" };

/**
 * INBOX-11 "Merge into…": pick the testimonial that keeps both (a likely
 * duplicate, or any other one of this project found by search). This one's
 * words and video become an extra answer there, and this one goes to the trash.
 */
export function MergeDialog({
  open,
  onClose,
  projectId,
  from,
  suggestions,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  from: { id: string; authorName: string };
  suggestions: MergeCandidate[];
  onMerged: (intoId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<MergeCandidate[]>([]);
  const [into, setInto] = useState<string>(suggestions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setInto(suggestions[0]?.id ?? "");
    setError(null);
    setQ("");
    setFound([]);
  }, [open, suggestions]);

  useEffect(() => {
    if (!open || !q.trim()) {
      setFound([]);
      return;
    }
    let live = true;
    const sp = new URLSearchParams({ tab: "all", q: q.trim(), size: "25" });
    api<{ items: MergeCandidate[] }>(`/api/admin/projects/${projectId}/testimonials?${sp}`)
      .then((r) => live && setFound(r.items.filter((t) => t.id !== from.id)))
      .catch(() => live && setFound([]));
    return () => {
      live = false;
    };
  }, [open, q, projectId, from.id]);

  const list = [...suggestions, ...found.filter((f) => !suggestions.some((s) => s.id === f.id))];
  const chosen = list.find((c) => c.id === into);

  async function merge() {
    if (!into) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/projects/${projectId}/testimonials/merge`, { method: "POST", json: { from: from.id, into } });
      onMerged(into);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Merge ${from.authorName}’s testimonial into…`}
      description="Both stay: this one’s words and video become an extra answer on the one you pick (only you see extra answers), tags and images are combined, and this one goes to the trash."
      size="lg"
      testId="merge-dialog"
      footer={
        <>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!into || busy} onClick={() => void merge()} data-testid="merge-confirm">
            {busy ? "Merging…" : chosen ? `Merge into ${chosen.authorName}’s` : "Merge"}
          </button>
        </>
      }
    >
      <SearchField label="Find another testimonial" value={q} onChange={setQ} placeholder="Search names or words…" showLabel testId="merge-search" />
      {list.length === 0 ? (
        <p className="muted small">{q ? "Nothing matches. Try their name." : "No likely duplicates. Search for the one to merge into."}</p>
      ) : (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small">{suggestions.length ? "Likely duplicates first" : "Pick one"}</legend>
          {list.map((c) => (
            <label key={c.id} className="row" style={{ alignItems: "flex-start", gap: "var(--space-2)" }} data-testid="merge-candidate">
              <input type="radio" name="merge-into" value={c.id} checked={into === c.id} onChange={() => setInto(c.id)} />
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong className="small">
                  {c.authorName} <span className="muted xsmall">· {STATUS[c.status] ?? c.status} · {new Date(c.createdAt).toLocaleDateString()}</span>
                </strong>
                {c.text && (
                  <span className="muted xsmall" style={{ overflowWrap: "anywhere" }}>
                    “{c.text.length > 160 ? `${c.text.slice(0, 159)}…` : c.text}”
                  </span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
