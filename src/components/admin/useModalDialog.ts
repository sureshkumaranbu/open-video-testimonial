import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { focusables } from "./keys";

/**
 * Drives a native <dialog> as a modal for Modal and Drawer. showModal() puts
 * it in the top layer and makes the rest of the page inert, so screen readers
 * stay inside and Tab wraps around within it; Escape arrives as a "cancel"
 * event, which becomes onClose. When it closes, focus goes back to whatever
 * opened it.
 *
 * Focus starts on the element marked `data-autofocus`; else on the first
 * control in `.ak-overlay-body` (`start: "body"`) or on the Close button
 * (`start: "close"`, `.ak-overlay-close`); else wherever the browser puts it.
 * (React's autoFocus runs before the dialog opens, so it can't be used.)
 */
export function useModalDialog(open: boolean, onClose: () => void, o: { start?: "body" | "close" } = {}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  const start = o.start ?? "body";
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const body = start === "body" ? dialog.querySelector<HTMLElement>(".ak-overlay-body") : null;
    const first =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      (body ? focusables(body)[0] : undefined) ??
      dialog.querySelector<HTMLElement>(".ak-overlay-close");
    first?.focus();

    const onCancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    // Browsers may close the dialog themselves (a second Escape can't be
    // cancelled); keep the owner's open state in step.
    const onNativeClose = () => close.current();
    // A native modal lets Tab run off its end into the browser's own UI; wrap
    // instead, so focus cycles through the dialog. A dialog opened from this
    // one handles its own keys.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!(e.target instanceof Element) || e.target.closest("dialog") !== dialog) return;
      const items = focusables(dialog);
      if (items.length === 0) return;
      const at = document.activeElement;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (at === first || at === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onNativeClose);
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onNativeClose);
      dialog.removeEventListener("keydown", onKeyDown);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, start]);

  return ref;
}

/**
 * Closes on a click on the shade around the panel. The press has to start
 * there too, so selecting text in the panel and letting go outside doesn't
 * close it.
 */
export function useScrimClose(onClose: () => void) {
  const pressed = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLDialogElement>) => {
      pressed.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLDialogElement>) => {
      if (pressed.current && e.target === e.currentTarget) onClose();
      pressed.current = false;
    },
  };
}
