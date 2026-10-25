import type { ReactNode } from "react";
import "@/app/admin/admin-kit.css";

/**
 * A labelled progress bar (a native <progress>, so its value is announced).
 * `value` null shows a moving "working" bar for when the total isn't known
 * yet. No state, so server pages can render it too.
 */
export type ProgressBarProps = {
  label: string;
  /** From 0 to `max`; null while unknown. */
  value: number | null;
  max?: number;
  /** A line under the bar, such as "12 of 50". */
  detail?: ReactNode;
  testId?: string;
};

export function ProgressBar({ label, value, max = 100, detail, testId }: ProgressBarProps) {
  const known = value != null && Number.isFinite(value);
  const clamped = known ? Math.min(Math.max(0, value), max) : 0;
  const percent = known && max > 0 ? Math.round((clamped / max) * 100) : null;
  return (
    <div className="ak-progress" data-testid={testId}>
      <label className="ak-progress-label">
        <span className="ak-progress-head">
          <span>{label}</span>
          {percent != null && <span className="ak-progress-pct">{percent}%</span>}
        </span>
        <progress value={known ? clamped : undefined} max={max} />
      </label>
      {detail && <p className="hint ak-hint">{detail}</p>}
    </div>
  );
}
