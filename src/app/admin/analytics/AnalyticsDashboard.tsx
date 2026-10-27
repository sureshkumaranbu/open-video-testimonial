"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { EmptyState } from "@/components/admin";
import { BarList, fmt, LineChart, Tile } from "@/components/analytics/charts";
import { pageName } from "@/components/analytics/InstallStatus";
import { presetRange, RangePicker, type Range } from "@/components/analytics/RangePicker";
import { RemovedAlerts } from "@/components/analytics/RemovedAlerts";
import { SortTable, type Column } from "@/components/analytics/SortTable";
import type { RemovedAlert } from "@/lib/analytics/rollup";
import type { DashboardReport } from "@/lib/analytics/report";
import { api } from "../api";

type Project = { id: string; name: string };
type WidgetRow = DashboardReport["tables"]["widgets"][number];
type FormRow = DashboardReport["tables"]["forms"][number];
type WallRow = DashboardReport["tables"]["walls"][number];

const rate = (r: number | null) => (r == null ? "–" : `${r}%`);
const STATE: Record<WidgetRow["state"], string> = { live: "Live", removed: "Not seen for 7 days", never: "Not on a site yet" };

/**
 * AN-01: the analytics dashboard. Tiles for the period with the change from
 * the period before, views by day, and sortable tables of widgets, forms and
 * walls. The project picker and the period change the URL-free state only.
 */
export function AnalyticsDashboard({ projects, initialProject, alerts: initialAlerts }: { projects: Project[]; initialProject: string; alerts: RemovedAlert[] }) {
  const id = useId();
  const [project, setProject] = useState(initialProject);
  const [range, setRange] = useState<Range>(() => presetRange(30));
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState(initialAlerts);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ ...range, project });
      setReport((await api<{ report: DashboardReport }>(`/api/admin/analytics?${q}`)).report);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [range, project]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!projects.length) {
    return (
      <EmptyState icon="chart" title="Nothing to count yet" testId="analytics-no-projects" action={<Link className="button accent" href="/admin">Create a project</Link>}>
        <p>Make a project, then put a widget on your site or share a form. Their numbers show up here.</p>
      </EmptyState>
    );
  }

  const shownAlerts = alerts.filter((a) => project === "all" || a.projectId === project);
  const r = report;
  const t = r?.tiles;
  const all = project === "all" && projects.length > 1;
  const hasTraffic = r ? r.series.views.some(Boolean) || r.series.previousViews.some(Boolean) : false;

  const widgetCols: Column<WidgetRow>[] = [
    { key: "name", label: "Widget", value: (w) => w.name, render: (w) => <Link href={`/admin/projects/${w.projectId}/widgets/${w.id}`}>{w.name}</Link> },
    ...(all ? [{ key: "project", label: "Project", value: (w: WidgetRow) => w.project }] : []),
    { key: "views", label: "Views", value: (w) => w.views, render: (w) => fmt(w.views), num: true },
    { key: "visitors", label: "Visitors", value: (w) => w.visitors, render: (w) => fmt(w.visitors), num: true },
    { key: "clicks", label: "Clicks", value: (w) => w.clicks, render: (w) => fmt(w.clicks), num: true },
    { key: "ctr", label: "Click rate", value: (w) => w.ctr, render: (w) => rate(w.ctr), num: true },
    { key: "state", label: "On your site", value: (w) => (w.state === "live" ? 0 : w.state === "removed" ? 1 : 2), render: (w) => (w.state === "live" && w.page ? `Live on ${pageName(w.page)}` : STATE[w.state]) },
  ];
  const formCols: Column<FormRow>[] = [
    { key: "name", label: "Form", value: (f) => f.name, render: (f) => <Link href={`/admin/projects/${f.projectId}/forms/${f.id}`}>{f.name}</Link> },
    ...(all ? [{ key: "project", label: "Project", value: (f: FormRow) => f.project }] : []),
    { key: "views", label: "Views", value: (f) => f.views, render: (f) => fmt(f.views), num: true },
    { key: "visitors", label: "Visitors", value: (f) => f.visitors, render: (f) => fmt(f.visitors), num: true },
    { key: "starts", label: "Starts", value: (f) => f.starts, render: (f) => (f.starts == null ? "–" : fmt(f.starts)), num: true },
    { key: "completions", label: "Completions", value: (f) => f.completions, render: (f) => fmt(f.completions), num: true },
    { key: "rate", label: "Completion", value: (f) => f.completionRate, render: (f) => rate(f.completionRate), num: true },
    { key: "rating", label: "Avg rating", value: (f) => f.rating, render: (f) => (f.rating == null ? "–" : f.rating.toFixed(1)), num: true },
  ];
  const wallCols: Column<WallRow>[] = [
    { key: "name", label: "Wall", value: (w) => w.name, render: (w) => <Link href={`/admin/projects/${w.projectId}/walls/${w.id}`}>{w.name}</Link> },
    ...(all ? [{ key: "project", label: "Project", value: (w: WallRow) => w.project }] : []),
    { key: "views", label: "Views", value: (w) => w.views, render: (w) => fmt(w.views), num: true },
    { key: "visitors", label: "Visitors", value: (w) => w.visitors, render: (w) => fmt(w.visitors), num: true },
    { key: "cta", label: "CTA clicks", value: (w) => w.ctaClicks, render: (w) => fmt(w.ctaClicks), num: true },
    { key: "links", label: "Link clicks", value: (w) => w.linkClicks, render: (w) => fmt(w.linkClicks), num: true },
  ];

  return (
    <div className="stack-lg" data-testid="analytics-dashboard">
      <div className="an-head">
        <div className="an-range">
          {projects.length > 1 && (
            <label htmlFor={`${id}-project`}>
              Project
              <select id={`${id}-project`} value={project} onChange={(e) => setProject(e.target.value)} data-testid="analytics-project">
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <RangePicker value={range} onChange={setRange} previous={r?.previousRange} testId="analytics-range" />
        </div>
      </div>

      <RemovedAlerts key={project} alerts={shownAlerts} onHidden={(widgetId) => setAlerts((a) => a.filter((x) => x.widgetId !== widgetId))} />

      {error && (
        <div className="notice warn row spread" role="alert">
          <p>Couldn&apos;t load the numbers: {error}</p>
          <button type="button" className="ghost small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!r && !error && <p className="muted">Loading…</p>}

      {r && t && (
        <>
          <div className="an-tiles" data-testid="analytics-tiles">
            <Tile
              label="New testimonials"
              value={fmt(t.testimonials.current.total)}
              current={t.testimonials.current.total}
              previous={t.testimonials.previous.total}
              sub={`Forms ${t.testimonials.current.bySource.form} · Imports ${t.testimonials.current.bySource.import} · Added ${t.testimonials.current.bySource.manual} · API ${t.testimonials.current.bySource.api}`}
              testId="tile-testimonials"
            />
            <Tile
              label="Waiting for review"
              value={fmt(t.backlog.pending)}
              sub={t.backlog.pending ? `Oldest waiting ${t.backlog.oldestDays === 0 ? "less than a day" : `${t.backlog.oldestDays} day${t.backlog.oldestDays === 1 ? "" : "s"}`}` : "All caught up"}
              testId="tile-backlog"
            />
            <Tile
              label="Average rating"
              value={t.rating.current.average != null ? `${t.rating.current.average.toFixed(1)} ★` : "–"}
              current={t.rating.current.average}
              previous={t.rating.previous.average}
              sub={`${fmt(t.rating.current.count)} rated, private feedback included`}
              testId="tile-rating"
            />
            <Tile label="Widget views" value={fmt(t.widgets.views)} current={t.widgets.views} previous={t.previous.widgets.views} testId="tile-widget-views" />
            <Tile label="Widget visitors" value={fmt(t.widgets.visitors)} current={t.widgets.visitors} previous={t.previous.widgets.visitors} sub="Counted once a day" testId="tile-widget-visitors" />
            <Tile label="Widget clicks" value={fmt(t.widgets.clicks)} current={t.widgets.clicks} previous={t.previous.widgets.clicks} sub="Read more, links, buttons, videos" testId="tile-widget-clicks" />
            <Tile label="Form views" value={fmt(t.forms.views)} current={t.forms.views} previous={t.previous.forms.views} testId="tile-form-views" />
            <Tile label="Form completions" value={fmt(t.forms.completions)} current={t.forms.completions} previous={t.previous.forms.completions} sub={t.forms.completionRate != null ? `${rate(t.forms.completionRate)} of views` : undefined} testId="tile-form-completions" />
            <Tile label="Wall views" value={fmt(t.walls.views)} current={t.walls.views} previous={t.previous.walls.views} testId="tile-wall-views" />
            <Tile label="Wall CTA clicks" value={fmt(t.walls.ctaClicks)} current={t.walls.ctaClicks} previous={t.previous.walls.ctaClicks} testId="tile-wall-cta" />
            <Tile label="Review booster clicks" value={fmt(t.booster.current)} current={t.booster.current} previous={t.booster.previous} testId="tile-booster" />
            <Tile label="Snippet renders" value={fmt(t.snippets.renders)} current={t.snippets.renders} previous={t.previous.snippets.renders} sub="Rich-result data loaded" testId="tile-snippets" />
          </div>

          <div className="an-grid-2">
            <div className="an-card">
              <h3>Views by day</h3>
              {hasTraffic ? (
                <LineChart days={r.days} values={r.series.views} previous={r.series.previousViews} label="Widget, form and wall views" testId="dashboard-chart" />
              ) : (
                <EmptyState icon="chart" title="No views in this period" level={3} testId="dashboard-chart-empty">
                  <p>Put a widget on your site, share a form or publish a wall. Views show here by day.</p>
                </EmptyState>
              )}
            </div>
            <div className="an-card" data-testid="invite-funnel">
              <h3>Invitations</h3>
              {t.invites.current.sent ? (
                <BarList
                  label="Campaign invitations sent in this period"
                  items={[
                    { key: "sent", label: "Sent", value: t.invites.current.sent },
                    ...(t.invites.current.opened != null ? [{ key: "opened", label: "Opened", value: t.invites.current.opened, sub: "Only campaigns that track opens" }] : []),
                    { key: "clicked", label: "Clicked the link", value: t.invites.current.clicked },
                    { key: "started", label: "Started the form", value: t.invites.current.started },
                    { key: "submitted", label: "Sent a testimonial", value: t.invites.current.submitted },
                  ]}
                />
              ) : (
                <p className="muted small">No campaign invitations went out in this period.</p>
              )}
            </div>
          </div>

          {t.dropped > 0 && (
            <p className="notice warn small" data-testid="dashboard-dropped">
              {fmt(t.dropped)} events past the daily limit weren&apos;t counted. That&apos;s usually a script, not people.
            </p>
          )}

          <section className="stack" aria-label="Widgets">
            <h2 style={{ fontSize: "var(--text-lg)", margin: 0 }}>Widgets</h2>
            {r.tables.widgets.length ? (
              <SortTable caption="Widgets" columns={widgetCols} rows={r.tables.widgets} initial="views" testId="widgets-table" />
            ) : (
              <p className="muted small">No widgets yet.</p>
            )}
          </section>
          <section className="stack" aria-label="Forms">
            <h2 style={{ fontSize: "var(--text-lg)", margin: 0 }}>Forms</h2>
            {r.tables.forms.length ? <SortTable caption="Forms" columns={formCols} rows={r.tables.forms} initial="views" testId="forms-table" /> : <p className="muted small">No forms yet.</p>}
          </section>
          <section className="stack" aria-label="Walls">
            <h2 style={{ fontSize: "var(--text-lg)", margin: 0 }}>Walls</h2>
            {r.tables.walls.length ? <SortTable caption="Walls" columns={wallCols} rows={r.tables.walls} initial="views" testId="walls-table" /> : <p className="muted small">No walls yet.</p>}
          </section>
          <p className="an-foot">
            Cookieless: no cookies, no IP addresses or browser details kept, no third-party scripts. A visitor is counted once a day, so “visitors” over a period adds up each day’s. Days are in UTC; today updates as it happens.
          </p>
        </>
      )}
    </div>
  );
}
