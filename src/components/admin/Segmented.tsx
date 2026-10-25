"use client";

/**
 * A short row of mutually exclusive buttons (the dashboard's `.segmented`
 * look) with aria-pressed. For switching views or a setting with two to four
 * values; use Tabs when each choice shows its own panel.
 */
export type SegmentedOption<V extends string> = { value: V; label: string; count?: number; disabled?: boolean };

export type SegmentedProps<V extends string> = {
  label: string;
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
  testId?: string;
};

export function Segmented<V extends string>({ label, options, value, onChange, className, testId }: SegmentedProps<V>) {
  return (
    <div className={className ? `segmented ${className}` : "segmented"} role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
          {o.count != null && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
