"use client";

import { useState, type ReactNode } from "react";
import { errorMessage } from "@/app/admin/api";
import { Modal } from "./Modal";

/**
 * Asks before an action, in place of window.confirm. With `requireText` the
 * person types it (a project name) before the button works, for actions that
 * can't be undone. It closes itself when `onConfirm` resolves; a thrown error
 * is shown inside and the dialog stays open. Focus starts on Cancel (or the
 * text box), so Enter never confirms by accident.
 */
export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  /** What will happen, in plain words. */
  children?: ReactNode;
  confirmLabel?: string;
  /** Shown on the button while `onConfirm` runs. */
  busyLabel?: string;
  cancelLabel?: string;
  /** A red confirm button, for deleting and other losses. */
  danger?: boolean;
  requireText?: string;
  testId?: string;
};

export function ConfirmDialog(props: ConfirmDialogProps) {
  // Mounting fresh on each open clears what was typed and any old error.
  return props.open ? <ConfirmBody {...props} /> : null;
}

function ConfirmBody({
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = "Confirm",
  busyLabel = "Working…",
  cancelLabel = "Cancel",
  danger,
  requireText,
  testId,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !requireText || typed === requireText;

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      title={title}
      testId={testId}
      // Nothing closes it halfway through the action.
      onClose={() => !busy && onClose()}
      onSubmit={(e) => {
        e.preventDefault();
        void confirm();
      }}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose} disabled={busy} data-autofocus={requireText ? undefined : true}>
            {cancelLabel}
          </button>
          <button type="submit" className={danger ? "ak-danger" : undefined} disabled={!ready || busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        {children && <div className="ak-confirm-text">{children}</div>}
        {requireText && (
          <label>
            <span>
              Type <strong className="ak-confirm-word">{requireText}</strong> to confirm
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
              data-autofocus
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
