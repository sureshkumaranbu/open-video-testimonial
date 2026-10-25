"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { useModalDialog, useScrimClose } from "./useModalDialog";
import "@/app/admin/admin-kit.css";

/** What Modal and Drawer share; each picks a look with `kind` and `size`. */
export type OverlayProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
  /** Extra controls in the header, before Close (the drawer's previous and next). */
  headerActions?: ReactNode;
  /** Makes the panel a <form>, so Enter submits and footer buttons can be type="submit". */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** A short line under the title, read out with it. */
  description?: ReactNode;
};

export function Overlay({
  kind,
  size,
  open,
  onClose,
  title,
  children,
  footer,
  testId,
  headerActions,
  onSubmit,
  description,
}: OverlayProps & { kind: "modal" | "drawer"; size: string }) {
  const id = useId();
  // A dialog starts on its first field; a drawer on Close, so reading starts at the top.
  const ref = useModalDialog(open, onClose, { start: kind === "modal" ? "body" : "close" });
  const scrim = useScrimClose(onClose);
  if (!open) return null;

  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  const inner = (
    <>
      <header className="ak-overlay-head">
        <div className="ak-overlay-titles">
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p id={descId} className="muted small">
              {description}
            </p>
          )}
        </div>
        <div className="ak-overlay-tools">
          {headerActions}
          <button type="button" className="ghost ak-icon-button ak-overlay-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="ak-overlay-body">{children}</div>
      {footer && <footer className="ak-overlay-foot">{footer}</footer>}
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`ak-overlay ak-${kind}`}
      data-size={size}
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid={testId}
      {...scrim}
    >
      {onSubmit ? (
        <form className="ak-overlay-panel" onSubmit={onSubmit}>
          {inner}
        </form>
      ) : (
        <div className="ak-overlay-panel">{inner}</div>
      )}
    </dialog>
  );
}
