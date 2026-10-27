"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/app/admin/api";
import type { RemovedAlert } from "@/lib/analytics/rollup";
import { pageName } from "./InstallStatus";
import "@/app/admin/analytics.css";

/**
 * DISP-13 in the app: widgets that were live and haven't been seen for 7
 * days, each with a link to it and a way to hide the alert. Nothing at all
 * when there are none.
 */
export function RemovedAlerts({ alerts: initial, onHidden }: { alerts: RemovedAlert[]; onHidden?: (widgetId: string) => void }) {
  const [alerts, setAlerts] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  if (!alerts.length) return null;
  async function hide(id: string) {
    try {
      await api(`/api/admin/widgets/${id}/dismiss-alert`, { method: "POST" });
      setAlerts((a) => a.filter((x) => x.widgetId !== id));
      onHidden?.(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="an-alerts" data-testid="removed-alerts">
      {alerts.map((a) => (
        <div key={a.widgetId} className="an-alert" role="status">
          <p>
            <strong>{a.name}</strong> hasn&apos;t been seen on your site for 7 days{a.page ? <> (it was on {pageName(a.page)})</> : null}.{" "}
            <Link href={`/admin/projects/${a.projectId}/widgets/${a.widgetId}`}>Check the widget</Link>
          </p>
          <button type="button" className="ghost small" onClick={() => void hide(a.widgetId)} data-testid="hide-removed-alert">
            Hide
          </button>
        </div>
      ))}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
