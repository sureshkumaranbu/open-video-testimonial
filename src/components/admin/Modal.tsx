"use client";

import type { FormEvent, ReactNode } from "react";
import { Overlay } from "./Overlay";

/**
 * A dialog. Closes on Escape and on the scrim; focus stays inside and returns
 * to the opener. Focus starts on the control marked `data-autofocus`, else on
 * the first field. Renders nothing while closed.
 */
export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  testId?: string;
  /** A short line under the title, read out with it. */
  description?: ReactNode;
  /** Makes the dialog a <form>: Enter submits, and footer buttons can be type="submit". */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
};

export function Modal({ size = "md", ...props }: ModalProps) {
  return <Overlay kind="modal" size={size} {...props} />;
}
