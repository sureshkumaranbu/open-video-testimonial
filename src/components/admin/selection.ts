/**
 * Row selection for lists with bulk actions (BulkBar), and the chip groups'
 * on/off lists. These never change what they're given; useSelection wraps
 * them in state.
 */

export type SelectState = "none" | "some" | "all";

export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Selects every one of `ids`, or clears them when they're all selected already. Others stay as they are. */
export function toggleAll(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  const all = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** How much of `ids` (the rows on screen) is selected; drives the header checkbox. */
export function selectState(selected: ReadonlySet<string>, ids: readonly string[]): SelectState {
  const on = ids.filter((id) => selected.has(id)).length;
  if (on === 0) return "none";
  return on === ids.length ? "all" : "some";
}

/** Shift-click: sets every row between `anchor` and `id` (inclusive) to `on`. */
export function selectRange(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  anchor: string,
  id: string,
  on: boolean,
): Set<string> {
  const a = ids.indexOf(anchor);
  const b = ids.indexOf(id);
  const next = new Set(selected);
  if (a < 0 || b < 0) {
    if (on) next.add(id);
    else next.delete(id);
    return next;
  }
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
    if (on) next.add(ids[i]);
    else next.delete(ids[i]);
  }
  return next;
}

/** Drops ids that are no longer listed (after a delete or a filter change). */
export function keepListed(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const listed = new Set(ids);
  return new Set([...selected].filter((id) => listed.has(id)));
}

/** Turns `id` on or off in `selected`; with `single`, picking one clears the rest. */
export function toggleValue(selected: readonly string[], id: string, single = false): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  return single ? [id] : [...selected, id];
}
