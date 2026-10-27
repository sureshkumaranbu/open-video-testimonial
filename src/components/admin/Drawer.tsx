"use client";

import type { FormEvent, ReactNode } from "react";
import { Overlay } from "./Overlay";

/**
 * A side panel over the page (the inbox detail view). Closes on Escape and on
 * the scrim; focus stays inside and returns to the opener. It fills the
 * screen on phones. Renders nothing while closed.
 */
export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Sticky actions at the bottom. */
  footer?: ReactNode;
  width?: "md" | "lg";
  testId?: string;
  /** Controls in the header before Close, such as previous and next. */
  headerActions?: ReactNode;
  /** A short line under the title, read out with it. */
  description?: ReactNode;
  /** Makes the panel a <form>, with the footer's buttons inside it. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
};

export function Drawer({ width = "md", ...props }: DrawerProps) {
  return <Overlay kind="drawer" size={width} {...props} />;
}
