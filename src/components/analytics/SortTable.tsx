"use client";

import { type ReactNode, useMemo, useState } from "react";

/**
 * A table sortable by any column (AN-01). The header buttons carry aria-sort;
 * numbers sort high first, text A to Z. Empty values (null) always go last.
 */
export type Column<T> = {
  key: string;
  label: string;
  /** What it sorts by. */
  value: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  num?: boolean;
};

export function SortTable<T extends { id: string }>({
  columns,
  rows,
  initial,
  caption,
  testId,
}: {
  columns: Column<T>[];
  rows: T[];
  initial: string;
  caption: string;
  testId?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>(() => ({ key: initial, dir: columns.find((c) => c.key === initial)?.num ? "desc" : "asc" }));
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.value(a);
      const y = col.value(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sign;
    });
  }, [rows, columns, sort]);
  const toggle = (c: Column<T>) =>
    setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.num ? "desc" : "asc" }));
  return (
    <div className="table-wrap">
      <table className="data-table an-table" data-testid={testId}>
        <caption className="visually-hidden">{caption}, sortable by any column</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.num ? "num" : undefined} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                <button type="button" onClick={() => toggle(c)} data-testid={`sort-${c.key}`}>
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} data-testid={testId ? `${testId}-row` : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? "num" : undefined}>
                  {c.render ? c.render(r) : (c.value(r) ?? "–")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
