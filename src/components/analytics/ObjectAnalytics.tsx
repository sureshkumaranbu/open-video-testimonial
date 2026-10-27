"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/app/admin/api";
import { EmptyState } from "@/components/admin";
import type { AnalyticsObject } from "@/db/schema";
import type { ObjectReport } from "@/lib/analytics/report";
import { BarList, fmt, LineChart, Tile } from "./charts";
import { presetRange, RangePicker, type Range } from "./RangePicker";
import { pageName } from "./InstallStatus";

const CLICK_LABELS: Record<string, string> = { more: "Read more", source: "Original review link", cta: "Call to action", play: "Video plays", link: "Other links", share: "Share buttons" };

const EMPTY: Record<AnalyticsObject, { title: string; body: string }> = {
  widget: { title: "No views yet", body: "Once the widget is on a page and someone opens it, views and clicks show here by day." },
  form: { title: "Nobody has opened this form yet", body: "Share its link or embed it. Views, starts, completions and where people stop show here." },
  wall: { title: "No visits yet", body: "Make the wall public and share its link. Views and clicks on its buttons and links show here." },
  snippet: { title: "Not fetched yet", body: "Each time a page (or a search engine) loads the dynamic snippet, it counts as a render here." },
  testimonial: { title: "No visits yet", body: "Once the testimonial is approved, share its own page. Views and clicks on its share buttons show here." },
};

/** The rate as "12.5%", or a dash when there's nothing to divide by. */
const rate = (r: number | null) => (r == null ? "–" : `${r}%`);

/**
 * DISP-14, FORM-15, WALL-05, SEO-04: one widget's, form's, wall's or
 * snippet's numbers for a period, compared with the period before.
 */
export function ObjectAnalytics({ type, id, heading = "Analytics" }: { type: AnalyticsObject; id: string; heading?: string }) {
  const [range, setRange] = useState<Range>(() => presetRange(30));
  const [report, setReport] = useState<ObjectReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams(range);
      setReport((await api<{ report: ObjectReport }>(`/api/admin/analytics/${type}/${id}?${q}`)).report);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [type, id, range]);
  useEffect(() => {
    void load();
  }, [load]);

  const r = report;
  const c = r?.current;
  const p = r?.previous;
  const nothing = c && c.views === 0 && c.renders === 0 && c.completions === 0 && r.previous.views === 0 && r.previous.renders === 0;
  const clicks = c ? Object.values(c.clicks).reduce((a, n) => a + (n ?? 0), 0) : 0;
  const prevClicks = p ? Object.values(p.clicks).reduce((a, n) => a + (n ?? 0), 0) : 0;

  return (
    <section className="stack" aria-labelledby={`an-${id}`} data-testid={`${type}-analytics`}>
      <div className="an-head">
        <h2 id={`an-${id}`} style={{ margin: 0, fontSize: "var(--text-lg)" }}>
          {heading}
        </h2>
        <RangePicker value={range} onChange={setRange} previous={r?.previousRange} />
      </div>
      {error && (
        <div className="notice warn row spread" role="alert">
          <p>Couldn&apos;t load the numbers: {error}</p>
          <button type="button" className="ghost small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!r && !error && <p className="muted">Loading…</p>}
      {r && c && p && nothing && (
        <EmptyState icon="chart" title={EMPTY[type].title} level={3} testId="analytics-empty">
          <p>{EMPTY[type].body}</p>
        </EmptyState>
      )}
      {r && c && p && !nothing && (
        <>
          <div className="an-tiles">
            {type === "snippet" ? (
              <Tile label="Renders" value={fmt(c.renders)} current={c.renders} previous={p.renders} testId="tile-renders" />
            ) : (
              <>
                <Tile label="Views" value={fmt(c.views)} current={c.views} previous={p.views} testId="tile-views" />
                <Tile label="Visitors" value={fmt(c.visitors)} current={c.visitors} previous={p.visitors} sub="Counted once a day" testId="tile-visitors" />
              </>
            )}
            {type === "widget" && (
              <Tile label="Clicks" value={fmt(clicks)} current={clicks} previous={prevClicks} sub={c.views ? `${Math.round((clicks / c.views) * 1000) / 10}% of views` : undefined} testId="tile-clicks" />
            )}
            {type === "wall" && (
              <>
                <Tile label="Call to action clicks" value={fmt(c.clicks.cta ?? 0)} current={c.clicks.cta ?? 0} previous={p.clicks.cta ?? 0} testId="tile-cta" />
                <Tile label="Link clicks" value={fmt(c.clicks.link ?? 0)} current={c.clicks.link ?? 0} previous={p.clicks.link ?? 0} testId="tile-links" />
              </>
            )}
            {type === "form" && r.funnel && (
              <>
                <Tile label="Starts" value={fmt(c.starts)} current={c.starts} previous={p.starts} testId="tile-starts" />
                <Tile label="Completions" value={fmt(c.completions)} current={c.completions} previous={p.completions} sub={c.completionRate != null ? `${rate(c.completionRate)} of views` : undefined} testId="tile-completions" />
                <Tile
                  label="Average rating"
                  value={r.funnel.rating.average != null ? `${r.funnel.rating.average.toFixed(1)} ★` : "–"}
                  current={r.funnel.rating.average}
                  previous={r.funnel.previousRating.average}
                  sub={`${r.funnel.rating.count} rated`}
                  testId="tile-rating"
                />
              </>
            )}
          </div>
          <div className="an-card">
            <LineChart
              days={r.days}
              values={r.series.views}
              previous={r.series.previousViews}
              label={type === "snippet" ? "Renders" : "Views"}
              testId="analytics-chart"
            />
          </div>
          <div className="an-grid-2">
            {type === "widget" && (
              <>
                <div className="an-card">
                  <h3>Clicks by kind</h3>
                  <BarList
                    label="Clicks by kind"
                    testId="clicks-by-kind"
                    items={Object.entries(c.clicks).map(([k, n]) => ({ key: k, label: CLICK_LABELS[k] ?? k, value: n ?? 0, sub: p.clicks[k as keyof typeof p.clicks] != null ? `${fmt(p.clicks[k as keyof typeof p.clicks] ?? 0)} before` : undefined }))}
                  />
                </div>
                <div className="an-card">
                  <h3>Top pages</h3>
                  {r.topPages.length ? (
                    <BarList
                      label="Top pages by views"
                      testId="top-pages"
                      unit="views"
                      items={r.topPages.map((d) => ({ key: d.dim, label: d.dim === "(other)" ? "Other pages" : pageName(d.dim), value: d.count, sub: `${fmt(d.uniques)} visitors` }))}
                    />
                  ) : (
                    <p className="muted small">No pages yet.</p>
                  )}
                </div>
              </>
            )}
            {type === "form" && r.funnel && (
              <div className="an-card">
                <h3>Where people stop</h3>
                {r.funnel.pages.length ? (
                  <BarList
                    label="Visitors who reached each page"
                    testId="form-dropoff"
                    unit="visitors"
                    items={[
                      ...r.funnel.pages.map((pg) => ({ key: String(pg.index), label: pg.label, value: pg.visitors })),
                      { key: "sent", label: "Sent", value: r.funnel.completions },
                    ]}
                  />
                ) : (
                  <p className="muted small">The classic page is a single page, so it counts views and completions only.</p>
                )}
              </div>
            )}
            {type === "snippet" && (
              <div className="an-card">
                <h3>Where it’s installed</h3>
                {r.sites.length ? (
                  <BarList label="Renders by site" testId="snippet-sites" items={r.sites.map((d) => ({ key: d.dim, label: pageName(d.dim), value: d.count }))} />
                ) : (
                  <p className="muted small">Browsers and crawlers didn’t say which site they came from.</p>
                )}
              </div>
            )}
          </div>
          {c.dropped > 0 && (
            <p className="notice warn small" data-testid="analytics-dropped">
              {fmt(c.dropped)} events past the daily limit (50,000 a day) weren&apos;t counted. That&apos;s usually a script, not people.
            </p>
          )}
        </>
      )}
      <p className="an-foot">
        Cookieless: no cookies, no IP addresses kept, no third-party scripts. A visitor is counted once a day. Days are in UTC; today updates as it happens.
      </p>
    </section>
  );
}
