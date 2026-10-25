"use client";

import type { ReactNode } from "react";
import type { IconName } from "@/components/Icon";

/**
 * The admin UI kit (plan §3.4), styled by src/app/admin/admin-kit.css with
 * prefixed classes. Published by WP1.1 as the contract (props and names);
 * WP1.7 owns and builds the components. Until then the overlays and fields
 * render nothing, and the wrappers render their children as they are.
 */

/** A side panel over the page (the inbox detail view). Closes on Escape and on the scrim; focus stays inside. */
export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Sticky actions at the bottom. */
  footer?: ReactNode;
  width?: "md" | "lg";
  testId?: string;
};
export function Drawer(props: DrawerProps): ReactNode {
  return null;
}

/** A dialog. Closes on Escape and on the scrim; focus stays inside and returns to the opener. */
export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  testId?: string;
};
export function Modal(props: ModalProps): ReactNode {
  return null;
}

/** A row of controls above a list (search, filters, sort, view), with role="toolbar". */
export type ToolbarProps = { label: string; children: ReactNode };
export function Toolbar(props: ToolbarProps): ReactNode {
  return props.children;
}

/** Page links for server-side pages; `page` counts from 1. */
export type PagerProps = {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** Shows a page-size picker when given. */
  pageSizes?: readonly number[];
  onPageSize?: (size: number) => void;
};
export function Pager(props: PagerProps): ReactNode {
  return null;
}

/** A labelled colour picker with a hex text box. An empty value means "use the default" when `allowEmpty`. */
export type ColorFieldProps = {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  name?: string;
  allowEmpty?: boolean;
  hint?: string;
};
export function ColorField(props: ColorFieldProps): ReactNode {
  return null;
}

/** A labelled font picker; each choice previews in its own font. */
export type FontChoice = { id: string; label: string; fallback?: string };
export type FontFieldProps = {
  label: string;
  value: string;
  onChange: (id: string) => void;
  choices: readonly FontChoice[];
  name?: string;
};
export function FontField(props: FontFieldProps): ReactNode {
  return null;
}

/** A read-only value (link, snippet) with a Copy button that confirms in an aria-live status. */
export type CopyFieldProps = { label: string; value: string; multiline?: boolean; testId?: string };
export function CopyField(props: CopyFieldProps): ReactNode {
  return null;
}

/** What a list shows when it has nothing yet: what goes here, and the first thing to do. */
export type EmptyStateProps = { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode; testId?: string };
export function EmptyState(props: EmptyStateProps): ReactNode {
  return null;
}

/** Asks before leaving the page (reload, close, in-app links) only while there are unsaved changes. */
export type UnsavedGuardProps = { dirty: boolean; message?: string };
export function UnsavedGuard(props: UnsavedGuardProps): ReactNode {
  return null;
}

/** Preview widths for builders. */
export const DEVICE_WIDTHS = { desktop: 1200, tablet: 768, mobile: 375 } as const;
export type Device = keyof typeof DEVICE_WIDTHS;
/** Shows its children at a device's width, with a desktop / tablet / mobile switch when `onDevice` is given. */
export type DevicePreviewProps = { device: Device; onDevice?: (d: Device) => void; label?: string; children: ReactNode };
export function DevicePreview(props: DevicePreviewProps): ReactNode {
  return props.children;
}
