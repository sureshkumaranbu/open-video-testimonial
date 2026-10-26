"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/app/admin/api";
import { Icon } from "@/components/Icon";
import { Stars } from "@/components/TestimonialCard";
import { timeAgo } from "../Dashboard";
import { InboxPager } from "./Pager";
import { EMPTY_TEXT } from "./types";

type FeedbackRow = {
  id: string;
  rating: number | null;
  text: string;
  authorName: string | null;
  authorEmail: string | null;
  testimonialId: string | null;
  source: string;
  createdAt: string;
};

/** The Feedback tab: private answers that are never published. */
export function FeedbackList({ projectId, version, onChanged }: { projectId: string; version: number; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<{ items: FeedbackRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/admin/projects/${projectId}/feedback?page=${page}&size=${pageSize}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [projectId, page, pageSize]);
  useEffect(() => {
    void load();
  }, [load, version]);

  async function remove(id: string) {
    if (!confirm("Delete this feedback for good? This can't be undone.")) return;
    try {
      await api(`/api/admin/projects/${projectId}/feedback`, { method: "DELETE", json: { ids: [id] } });
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="stack" data-testid="feedback-list">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">Loading feedback…</p>}
      {data && data.items.length === 0 && (
        <div className="empty">
          <Icon name="inbox" />
          <p>{EMPTY_TEXT.feedback}</p>
        </div>
      )}
      {data?.items.map((f) => (
        <article key={f.id} className="panel review" data-testid="feedback-item">
          <div className="row spread">
            <strong>{f.authorName || "Someone"}</strong>
            <span className="muted xsmall">
              {f.source === "low-rating" ? "Low rating · " : ""}
              {timeAgo(f.createdAt)}
            </span>
          </div>
          {f.rating ? <Stars rating={f.rating} /> : null}
          <p style={{ whiteSpace: "pre-line", margin: 0 }}>{f.text}</p>
          {f.authorEmail && <p className="muted xsmall">{f.authorEmail}</p>}
          <div className="review-actions">
            <button type="button" className="danger small" onClick={() => void remove(f.id)}>
              <Icon name="trash" />
              Delete feedback
            </button>
          </div>
        </article>
      ))}
      {data && (
        <InboxPager
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
