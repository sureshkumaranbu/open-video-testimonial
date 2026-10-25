"use client";

import { useEffect } from "react";
import { leavesPage } from "./navigation";

/**
 * Asks before leaving the page (reload, close, in-app links) only while there
 * are unsaved changes (FORM-02: never when nothing changed). In-app links are
 * caught before the router sees them; the browser's back button and
 * router.push() from code are not, so builders save before navigating
 * themselves. Renders nothing.
 */
export type UnsavedGuardProps = { dirty: boolean; message?: string };

const DEFAULT_MESSAGE = "You have unsaved changes. Leave this page and lose them?";

export function UnsavedGuard({ dirty, message = DEFAULT_MESSAGE }: UnsavedGuardProps) {
  useEffect(() => {
    if (!dirty) return;
    // Set once the person agrees to leave by a link, so a full page load
    // doesn't ask a second time through beforeunload.
    let agreed = false;
    let reset: ReturnType<typeof setTimeout> | undefined;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (agreed) return;
      e.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || !leavesPage(e, anchor, window.location.href)) return;
      if (window.confirm(message)) {
        agreed = true;
        clearTimeout(reset);
        reset = setTimeout(() => (agreed = false), 1000);
        return;
      }
      // Capture phase on document runs before the router's own click handler.
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      clearTimeout(reset);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, message]);

  return null;
}
