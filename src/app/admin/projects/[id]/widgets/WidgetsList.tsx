"use client";

import "@/app/admin/widgets-admin.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/admin/api";
import { ConfirmDialog, EmptyState } from "@/components/admin";
import { pageName } from "@/components/analytics/InstallStatus";
import { Icon } from "@/components/Icon";
import type { WidgetLayout } from "@/db/schema";
import { FLAGGED_LAYOUTS, LAYOUT_LABELS, LAYOUTS, PLACEMENT_LABELS, PLACEMENTS, placementHint } from "@/lib/widget-config";
import type { AdminWidget } from "@/lib/widgets";
import { LayoutThumb } from "./LayoutThumb";

/** DISP-12, DISP-13: per widget, whether it's on a site and its views in the last 30 days (absent with analytics off). */
type Stats = Record<string, { state: "live" | "removed" | "never"; page: string | null; views: number }>;
type Props = { projectId: string; initial: AdminWidget[]; stats?: Stats };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** DISP-12 and DISP-15: the widgets list, and a new widget with a layout suggested by where it goes. */
export function WidgetsList({ projectId, initial, stats, commerce = false }: Props & { commerce?: boolean }) {
  const router = useRouter();
  const [widgets, setWidgets] = useState(initial);
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState("");
  const [layout, setLayout] = useState<WidgetLayout>("grid");
  const [touchedLayout, setTouchedLayout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminWidget | null>(null);
  const hint = placementHint(placement);

  async function reload() {
    setWidgets((await api<{ widgets: AdminWidget[] }>(`/api/admin/projects/${projectId}/widgets`)).widgets);
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { widget } = await api<{ widget: AdminWidget }>(`/api/admin/projects/${projectId}/widgets`, {
        method: "POST",
        json: { name, layout, placement: placement || null },
      });
      router.push(`/admin/projects/${projectId}/widgets/${widget.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function choosePlacement(p: string) {
    setPlacement(p);
    // Until a layout is picked by hand, follow the suggestion.
    const h = placementHint(p);
    if (h && !touchedLayout) setLayout(h.layouts[0]);
  }

  return (
    <div className="stack-lg">
      <form className="panel" onSubmit={create} data-testid="new-widget">
        <div className="panel-body stack">
          <div className="ws-new">
            <label>
              New widget name
              <input id="new-widget-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Home page wall" />
            </label>
            <label>
              Where it goes
              <select value={placement} onChange={(e) => choosePlacement(e.target.value)}>
                <option value="">Not sure yet</option>
                {PLACEMENTS.map((p) => (
                  <option key={p} value={p}>
                    {PLACEMENT_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Layout
              <select
                value={layout}
                onChange={(e) => {
                  setLayout(e.target.value as WidgetLayout);
                  setTouchedLayout(true);
                }}
              >
                {LAYOUTS.filter((l) => !FLAGGED_LAYOUTS[l] || commerce).map((l) => (
                  <option key={l} value={l}>
                    {LAYOUT_LABELS[l].name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="accent" disabled={busy || !name.trim()}>
              <Icon name="plus" />
              {busy ? "Creating…" : "Create widget"}
            </button>
          </div>
          {hint && (
            <p className="ws-hint" data-testid="placement-hint">
              {hint.text}
            </p>
          )}
        </div>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {widgets.length === 0 ? (
        <EmptyState
          icon="layout"
          title="No widgets yet"
          testId="widgets-empty"
          action={
            <button type="button" onClick={() => document.getElementById("new-widget-name")?.focus()}>
              Create a widget
            </button>
          }
        >
          <p>Create one above to show your testimonials on your site. Embeds that use your project&apos;s slug keep working.</p>
        </EmptyState>
      ) : (
        <div className="panel">
          <table className="ws-table" data-testid="widgets-table">
            <thead>
              <tr>
                <th scope="col">Widget</th>
                <th scope="col">Layout</th>
                <th scope="col">For</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {widgets.map((w) => (
                <tr key={w.id} data-testid="widget-row" data-widget-id={w.id}>
                  <td>
                    <Link className="ws-name" href={`/admin/projects/${projectId}/widgets/${w.id}`}>
                      <LayoutThumb layout={w.layout} />
                      {w.name}
                    </Link>
                    {stats?.[w.id] && <WidgetStat stat={stats[w.id]} />}
                  </td>
                  <td>{LAYOUT_LABELS[w.layout].name}</td>
                  <td className="muted">{w.placement ? PLACEMENT_LABELS[w.placement as keyof typeof PLACEMENT_LABELS] ?? w.placement : "—"}</td>
                  <td className="muted">{dateFormat.format(new Date(w.createdAt))}</td>
                  <td>
                    <div className="ws-actions">
                      <Link className="button secondary small" href={`/admin/projects/${projectId}/widgets/${w.id}`}>
                        <Icon name="pen" />
                        Edit
                      </Link>
                      <Link className="button secondary small" href={`/admin/projects/${projectId}/widgets/${w.id}?tab=share`}>
                        <Icon name="code" />
                        Embed
                      </Link>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => act(() => api(`/api/admin/widgets/${w.id}/duplicate`, { method: "POST" }))}
                      >
                        <Icon name="copy" />
                        Duplicate
                      </button>
                      <button type="button" className="secondary small danger" onClick={() => setDeleting(w)}>
                        <Icon name="trash" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete widget"
        busyLabel="Deleting…"
        danger
        onConfirm={async () => {
          const w = deleting!;
          await act(() => api(`/api/admin/widgets/${w.id}`, { method: "DELETE" }));
          setDeleting(null);
        }}
      >
        <p>Pages that embed it will show nothing from now on. Your other widgets and testimonials stay as they are.</p>
      </ConfirmDialog>
    </div>
  );
}

function WidgetStat({ stat }: { stat: Stats[string] }) {
  const where = stat.state === "live" && stat.page ? `Live on ${pageName(stat.page)}` : stat.state === "removed" ? "Not seen for 7 days" : "Not on a site yet";
  return (
    <span className="muted xsmall" style={{ display: "block", marginTop: 2 }} data-testid="widget-stat" data-state={stat.state}>
      {where} · {stat.views.toLocaleString("en-GB")} view{stat.views === 1 ? "" : "s"} in 30 days
    </span>
  );
}
