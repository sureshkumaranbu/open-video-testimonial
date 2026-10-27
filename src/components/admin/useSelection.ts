"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { keepListed, selectRange, selectState, toggleAll, toggleId } from "./selection";

/**
 * Selection state for the rows on screen (`ids`). `toggle(id, {range: true})`
 * extends from the last row toggled, for shift-click.
 */
export function useSelection(ids: readonly string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  const toggle = useCallback(
    (id: string, o?: { range?: boolean }) => {
      const from = o?.range ? anchor.current : null;
      anchor.current = id;
      setSelected((s) => (from ? selectRange(s, ids, from, id, !s.has(id)) : toggleId(s, id)));
    },
    [ids],
  );
  const toggleAllRows = useCallback(() => setSelected((s) => toggleAll(s, ids)), [ids]);
  const clear = useCallback(() => {
    anchor.current = null;
    setSelected(new Set());
  }, []);
  const set = useCallback((list: Iterable<string>) => setSelected(new Set(list)), []);
  const prune = useCallback(() => setSelected((s) => keepListed(s, ids)), [ids]);

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      selectedIds: [...selected],
      has: (id: string) => selected.has(id),
      state: selectState(selected, ids),
      toggle,
      toggleAll: toggleAllRows,
      clear,
      set,
      prune,
    }),
    [selected, ids, toggle, toggleAllRows, clear, set, prune],
  );
}
