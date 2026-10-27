"use client";

import { useState } from "react";
import { api } from "@/app/admin/api";
import type { InstallStatus as Status } from "@/lib/analytics/rollup";
import "@/app/admin/analytics.css";

/** "example.com/pricing" for people to read. */
export const pageName = (page: string) => page.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || page;

const when = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/**
 * DISP-13: where a widget is live ("Live on example.com/pricing"), that it
 * hasn't been seen yet, or that it seems to have come off the site, with a
 * way to hide that alert.
 */
export function InstallStatus({ widgetId, status }: { widgetId: string; status: Status }) {
  const [dismissed, setDismissed] = useState(status.removedDismissed);
  const [error, setError] = useState<string | null>(null);
  const others = status.pages.filter((p) => p.page !== status.lastSeenPage);
  async function dismiss() {
    try {
      await api(`/api/admin/widgets/${widgetId}/dismiss-alert`, { method: "POST" });
      setDismissed(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="an-install" data-state={status.state} data-testid="install-status" role="status">
      <span className="an-dot" aria-hidden />
      {status.state === "live" && status.lastSeenPage && (
        <>
          <span>
            Live on <strong data-testid="install-page">{pageName(status.lastSeenPage)}</strong>
          </span>
          {status.lastSeenAt && <span className="muted small">Last seen {when(status.lastSeenAt)}</span>}
          {others.length > 0 && (
            <p className="an-install-more">
              Also on {others.slice(0, 3).map((p) => pageName(p.page)).join(", ")}
              {others.length > 3 ? ` and ${others.length - 3} more` : ""} in the last 7 days.
            </p>
          )}
        </>
      )}
      {status.state === "never" && (
        <span>
          Not seen on a website yet. Paste the embed code (the Share tab) into your page: it shows as live after the first visit.
          {status.hostedViews > 0 ? ` Its hosted link was opened ${status.hostedViews} time${status.hostedViews === 1 ? "" : "s"}.` : ""}
        </span>
      )}
      {status.state === "removed" && (
        <>
          <span>
            <strong>Not seen for 7 days.</strong> It was last on {status.lastSeenPage ? pageName(status.lastSeenPage) : "your site"}
            {status.lastSeenAt ? ` on ${when(status.lastSeenAt)}` : ""}. If you took it off on purpose, there&apos;s nothing to do; otherwise check the embed code is still on the page.
          </span>
          {status.removedAt && !dismissed && (
            <button type="button" className="ghost small" onClick={() => void dismiss()} data-testid="dismiss-removed">
              Hide this alert
            </button>
          )}
        </>
      )}
      {error && (
        <p className="error small" role="alert" style={{ flexBasis: "100%", margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
