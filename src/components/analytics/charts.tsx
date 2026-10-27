import type { ReactNode } from "react";
import "@/app/admin/analytics.css";

/**
 * The analytics building blocks (AN-01): number tiles with a comparison, a
 * line chart and horizontal bars. Our own SVG and CSS, no chart library;
 * colours come from the theme tokens, so light and dark both read. Stateless,
 * so server pages can render them too.
 */

export const fmt = (n: number) => n.toLocaleString("en-GB");

/** "12 Oct" from YYYY-MM-DD, in UTC like the data. */
export function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** The change from the previous period, as text a screen reader can say. */
export function Delta({ current, previous, testId }: { current: number | null; previous: number | null; testId?: string }) {
  if (current == null || previous == null) return null;
  if (previous === 0 && current === 0) return null;
  let dir: "up" | "down" | "same" = current > previous ? "up" : current < previous ? "down" : "same";
  let text: string;
  if (previous === 0) text = "New this period";
  else {
    const pct = Math.round(((current - previous) / previous) * 100);
    if (pct === 0) dir = "same";
    text = pct === 0 ? "Same as before" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`;
  }
  const said = dir === "same" ? "about the same as the previous period" : `${dir === "up" ? "up" : "down"} from ${fmt(previous)} in the previous period`;
  return (
    <span className="an-delta" data-dir={dir} data-testid={testId}>
      <span aria-hidden>{text}</span>
      <span className="visually-hidden">{said}</span>
    </span>
  );
}

export function Tile({
  label,
  value,
  current,
  previous,
  sub,
  testId,
}: {
  label: string;
  value: ReactNode;
  /** With `previous`, shows the change. */
  current?: number | null;
  previous?: number | null;
  sub?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="an-tile" data-testid={testId}>
      <span className="an-tile-label">{label}</span>
      <span className="an-tile-value" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </span>
      {current !== undefined && previous !== undefined && <Delta current={current} previous={previous} />}
      {sub && <span className="an-tile-sub">{sub}</span>}
    </div>
  );
}

const W = 600;
const H = 140;

function points(values: number[], max: number) {
  // One day still draws a line across, so there's something to see.
  const v = values.length === 1 ? [values[0], values[0]] : values;
  return v.map((n, i) => `${((i / Math.max(v.length - 1, 1)) * W).toFixed(1)},${(H - (n / max) * H).toFixed(1)}`);
}

/**
 * Daily values as a line, with the previous period as a dashed line behind
 * it. The SVG stretches to its box; labels are HTML around it.
 */
export function LineChart({ days, values, previous, label, testId }: { days: string[]; values: number[]; previous?: number[]; label: string; testId?: string }) {
  const max = Math.max(1, ...values, ...(previous ?? []));
  const pts = points(values, max);
  const total = values.reduce((a, n) => a + n, 0);
  const before = previous?.reduce((a, n) => a + n, 0);
  const summary = `${label} per day from ${shortDay(days[0])} to ${shortDay(days.at(-1)!)}: ${fmt(total)} in all${before != null ? `, ${fmt(before)} in the previous period` : ""}; the busiest day had ${fmt(Math.max(0, ...values))}.`;
  return (
    <figure className="an-chart" data-testid={testId} style={{ margin: 0 }}>
      <div className="an-chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={summary}>
          {previous && <polyline className="an-line-prev" points={points(previous, max).join(" ")} />}
          <polygon className="an-area" points={`0,${H} ${pts.join(" ")} ${W},${H}`} />
          <polyline className="an-line" points={pts.join(" ")} />
        </svg>
        <span className="an-chart-max" aria-hidden>
          {fmt(max)}
        </span>
      </div>
      <div className="an-chart-axis" aria-hidden>
        <span>{shortDay(days[0])}</span>
        {days.length > 2 && <span>{shortDay(days[Math.floor(days.length / 2)])}</span>}
        <span>{shortDay(days.at(-1)!)}</span>
      </div>
      <figcaption className="an-legend">
        <span>{label}</span>
        {previous && <span className="prev">Previous period</span>}
      </figcaption>
    </figure>
  );
}

export type Bar = { label: ReactNode; value: number; sub?: ReactNode; key: string };

/** Horizontal bars, longest first as given; the widest is 100%. */
export function BarList({ items, label, testId, unit }: { items: Bar[]; label: string; testId?: string; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="an-bars" aria-label={label} data-testid={testId}>
      {items.map((i) => (
        <li key={i.key}>
          <span className="an-bar-label">{i.label}</span>
          <span className="an-bar-value">
            {fmt(i.value)}
            {unit && <span className="visually-hidden"> {unit}</span>}
          </span>
          <span className="an-bar-track" aria-hidden>
            <span style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          {i.sub && <span className="an-bar-sub">{i.sub}</span>}
        </li>
      ))}
    </ul>
  );
}
