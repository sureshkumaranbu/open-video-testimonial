"use client";

import { useId, useState } from "react";
import { shortDay } from "./charts";

/**
 * The period a report covers (AN-01): last 7, 30 or 90 days, 12 months, or
 * any two dates (there's no limit on how far back). Days are UTC, like the
 * data. The previous period of the same length is compared automatically.
 */
export type Range = { from: string; to: string };
type Preset = "7" | "30" | "90" | "365" | "custom";

const DAY_MS = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const back = (to: string, days: number) => new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);

export function presetRange(days: number): Range {
  const to = today();
  return { from: back(to, days), to };
}

function presetOf(r: Range): Preset {
  if (r.to !== today()) return "custom";
  for (const p of ["7", "30", "90", "365"] as const) if (r.from === back(r.to, Number(p))) return p;
  return "custom";
}

export function RangePicker({ value, onChange, previous, testId }: { value: Range; onChange: (r: Range) => void; previous?: Range; testId?: string }) {
  const id = useId();
  const [preset, setPreset] = useState<Preset>(() => presetOf(value));
  const choose = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") onChange(presetRange(Number(p)));
  };
  return (
    <div className="an-range" data-testid={testId}>
      <label htmlFor={`${id}-p`}>
        Period
        <select id={`${id}-p`} value={preset} onChange={(e) => choose(e.target.value as Preset)} data-testid="range-preset">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
          <option value="custom">Choose dates…</option>
        </select>
      </label>
      {preset === "custom" && (
        <>
          <label>
            From
            <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} data-testid="range-from" />
          </label>
          <label>
            To
            <input type="date" value={value.to} min={value.from} max={today()} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} data-testid="range-to" />
          </label>
        </>
      )}
      {previous && (
        <span className="an-compare" style={{ alignSelf: "center" }}>
          Compared with {shortDay(previous.from)} – {shortDay(previous.to)}
        </span>
      )}
    </div>
  );
}
