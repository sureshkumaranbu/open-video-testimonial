"use client";

import { Checkbox } from "@/components/admin";
import { Icon } from "@/components/Icon";
import { PlatformIcon } from "@/components/PlatformIcon";
import { Stars } from "@/components/TestimonialCard";
import { timeAgo } from "../Dashboard";
import type { CardCallbacks } from "./Inbox";
import { sourceLabel, type InboxRow } from "./types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  hidden: "Hidden",
  rejected: "Rejected",
  trashed: "In trash",
};

/** The dense view: one line per testimonial. Details opens the drawer, where everything can be edited. */
export function TableView({ items, selection, ...cb }: { items: InboxRow[] } & CardCallbacks) {
  return (
    <div className="ib-table-wrap">
      <table className="ib-table" data-testid="inbox-table">
        <thead>
          <tr>
            <th scope="col" className="ib-col-select">
              <Checkbox
                label="Select all on this page"
                hideLabel
                checked={selection.state === "all"}
                indeterminate={selection.state === "some"}
                onChange={() => selection.toggleAll()}
              />
            </th>
            <th scope="col">Person</th>
            <th scope="col">Testimonial</th>
            <th scope="col" className="ib-col-narrow">Source</th>
            <th scope="col" className="ib-col-narrow">Status</th>
            <th scope="col" className="ib-col-narrow">Added</th>
            <th scope="col" className="ib-col-narrow">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => {
            const text = t.text || t.transcript || t.headline || "";
            return (
              <tr key={t.id} data-testid="inbox-row" data-status={t.status} aria-selected={selection.has(t.id)}>
                <td className="ib-col-select">
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.authorName}`}
                    checked={selection.has(t.id)}
                    onChange={(e) => selection.toggle(t.id, { range: (e.nativeEvent as MouseEvent).shiftKey })}
                  />
                </td>
                <td>
                  <strong className="small">{t.authorName}</strong>
                  {(t.authorTitle || t.authorCompany) && <div className="muted xsmall">{[t.authorTitle, t.authorCompany].filter(Boolean).join(", ")}</div>}
                </td>
                <td className="ib-col-text">
                  {t.rating ? <Stars rating={t.rating} /> : null}
                  <span className="ib-excerpt small">{text}</span>
                  <span className="ib-kinds muted xsmall">
                    {(t.videoKey || t.answerVideoCount > 0) && (
                      <span title="Has video">
                        <Icon name="video" />
                      </span>
                    )}
                    {t.imageCount > 0 && (
                      <span title="Has images">
                        <Icon name="image" />
                      </span>
                    )}
                    {t.tags.length > 0 && <span>{t.tags.join(", ")}</span>}
                  </span>
                </td>
                <td className="small">
                  {t.platform && <PlatformIcon platform={t.platform} className="ib-source-icon" />} {sourceLabel(t)}
                </td>
                <td>
                  <span className={`badge ${t.withdrawnAt ? "rejected" : t.status}`}>{t.withdrawnAt ? "Withdrawn" : STATUS_LABEL[t.status]}</span>
                </td>
                <td className="muted xsmall">{timeAgo(t.createdAt)}</td>
                <td>
                  <button type="button" className="ghost small" onClick={() => cb.onOpen(t.id)} aria-label={`Details for ${t.authorName}`}>
                    <Icon name="eye" />
                    Details
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
