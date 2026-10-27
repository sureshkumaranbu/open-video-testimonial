"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { toggleValue } from "./selection";
import "@/app/admin/admin-kit.css";

/**
 * Quick filters as toggle chips (Video, Text, 5 stars…), each with
 * aria-pressed. Several can be on unless `single`.
 */
export type FilterChip = { id: string; label: string; count?: number; icon?: IconName; disabled?: boolean };

export type FilterChipsProps = {
  label: string;
  chips: readonly FilterChip[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  single?: boolean;
  testId?: string;
};

export function FilterChips({ label, chips, selected, onChange, single, testId }: FilterChipsProps) {
  return (
    <div className="ak-chips" role="group" aria-label={label} data-testid={testId}>
      {chips.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            className="ak-chip"
            aria-pressed={on}
            disabled={c.disabled}
            onClick={() => onChange(toggleValue(selected, c.id, single))}
          >
            {/* A tick as well as the fill, so "on" doesn't rest on colour alone. */}
            {on ? <Icon name="check" /> : c.icon && <Icon name={c.icon} />}
            {c.label}
            {c.count != null && <span className="count">{c.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The filters in force, each a chip that removes it, plus "Clear all". After
 * a removal focus moves to the next chip, so keyboard users don't land at the
 * top of the page; when none are left it goes to `emptyFocus` (say, the
 * Filters button). Renders nothing when there are no filters.
 */
export type ActiveFilter = { id: string; label: string };

export type ActiveFiltersProps = {
  filters: readonly ActiveFilter[];
  onRemove: (id: string) => void;
  onClear?: () => void;
  label?: string;
  emptyFocus?: RefObject<HTMLElement | null>;
  testId?: string;
};

export function ActiveFilters({ filters, onRemove, onClear, label = "Filters in use", emptyFocus, testId }: ActiveFiltersProps) {
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<number | null>(null);

  useEffect(() => {
    const at = refocus.current;
    if (at == null) return;
    refocus.current = null;
    const chips = root.current?.querySelectorAll<HTMLElement>(".ak-chip");
    if (chips && chips.length) chips[Math.min(at, chips.length - 1)].focus();
    else emptyFocus?.current?.focus();
  }, [filters, emptyFocus]);

  if (filters.length === 0) return null;
  return (
    <div ref={root} className="ak-active" role="group" aria-label={label} data-testid={testId}>
      <ul className="ak-chips">
        {filters.map((f, i) => (
          <li key={f.id}>
            <button
              type="button"
              className="ak-chip"
              data-removable
              aria-label={`${f.label}, remove filter`}
              onClick={() => {
                refocus.current = i;
                onRemove(f.id);
              }}
            >
              {f.label}
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      {onClear && filters.length > 1 && (
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            refocus.current = 0;
            onClear();
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
