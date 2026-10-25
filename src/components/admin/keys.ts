/**
 * Keyboard helpers shared by Tabs, Toolbar and the chip groups. Pure, so the
 * tests can run them without a DOM.
 */

/** Keys that move focus along a row: the arrows, plus Home and End. */
export type RowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export const isRowKey = (key: string): key is RowKey =>
  key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";

/**
 * The index focus moves to from `current` in a row of `count` items, skipping
 * disabled ones and wrapping at the ends. Returns `current` when nothing else
 * can take focus. `vertical` also accepts the up and down arrows.
 */
export function nextIndex(
  current: number,
  key: RowKey,
  count: number,
  o: { disabled?: (i: number) => boolean; vertical?: boolean; rtl?: boolean } = {},
): number {
  if (count <= 0) return -1;
  const usable = (i: number) => !o.disabled?.(i);
  const scan = (from: number, step: 1 | -1) => {
    for (let n = 1; n <= count; n++) {
      const i = (((from + step * n) % count) + count) % count;
      if (usable(i)) return i;
    }
    return current;
  };
  const forward = o.rtl ? "ArrowLeft" : "ArrowRight";
  const back = o.rtl ? "ArrowRight" : "ArrowLeft";
  if (key === "Home") return usable(0) ? 0 : scan(0, 1);
  if (key === "End") return usable(count - 1) ? count - 1 : scan(count - 1, -1);
  if (key === forward || (o.vertical && key === "ArrowDown")) return scan(current, 1);
  if (key === back || (o.vertical && key === "ArrowUp")) return scan(current, -1);
  return current;
}

/** Controls that keep the arrow keys for themselves (moving the caret, changing a value). */
export function ownsArrowKeys(el: { tagName: string; type?: string; isContentEditable?: boolean } | null) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;
  // Radios keep theirs too: the arrows move the choice within the group.
  return !["button", "submit", "reset", "checkbox", "color", "file", "image"].includes((el.type || "text").toLowerCase());
}

/** Everything inside `root` that can take focus by Tab, in DOM order. */
export const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[inert], [hidden]") && el.getClientRects().length > 0,
  );
}
