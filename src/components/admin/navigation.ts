/** What UnsavedGuard treats as leaving the page. Pure, so the tests need no DOM. */

export type ClickLike = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

export type AnchorLike = { href: string; target: string; hasAttribute(name: string): boolean };

/**
 * True when clicking `anchor` would take this tab to another page (in-app
 * links included, since the router swaps the page without an unload). New
 * tabs, downloads, modified clicks and jumps within the page don't count.
 */
export function leavesPage(e: ClickLike, anchor: AnchorLike | null, here: string): boolean {
  if (!anchor || e.defaultPrevented || e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (anchor.hasAttribute("download")) return false;
  const target = anchor.target.toLowerCase();
  if (target && target !== "_self" && target !== "_top" && target !== "_parent") return false;
  let to: URL;
  let from: URL;
  try {
    from = new URL(here);
    to = new URL(anchor.href, from);
  } catch {
    return false;
  }
  // mailto:, tel: and the like open another app; this page stays.
  if (to.protocol !== "http:" && to.protocol !== "https:") return false;
  // The same URL, or one that differs only in its #fragment, keeps this page.
  return !(to.origin === from.origin && to.pathname === from.pathname && to.search === from.search);
}
