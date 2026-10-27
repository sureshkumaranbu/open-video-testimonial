/**
 * The admin UI kit (plan §3.4), styled by src/app/admin/admin-kit.css with
 * `ak-` classes on top of the globals.css tokens. Each component file marks
 * itself "use client" when it needs the browser; EmptyState and ProgressBar
 * have no state, so server pages can render them as well.
 *
 * Shared rules: every control has a visible or screen-reader label, state is
 * in aria-* and data-* attributes, `testId` becomes data-testid, overlays are
 * native modal <dialog>s, and everything works from the keyboard (WCAG 2.2 AA).
 */

export { Modal, type ModalProps } from "./Modal";
export { Drawer, type DrawerProps } from "./Drawer";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { Toolbar, type ToolbarProps } from "./Toolbar";
export { Pager, type PagerProps } from "./Pager";
export { ColorField, type ColorFieldProps } from "./ColorField";
export { FontField, type FontFieldProps } from "./FontField";
export { CopyField, type CopyFieldProps } from "./CopyField";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { UnsavedGuard, type UnsavedGuardProps } from "./UnsavedGuard";
export { DevicePreview, type DevicePreviewProps } from "./DevicePreview";
export { Tabs, type TabItem, type TabsProps } from "./Tabs";
export { Segmented, type SegmentedOption, type SegmentedProps } from "./Segmented";
export {
  ActiveFilters,
  FilterChips,
  type ActiveFilter,
  type ActiveFiltersProps,
  type FilterChip,
  type FilterChipsProps,
} from "./FilterChips";
export { BulkBar, type BulkBarProps } from "./BulkBar";
export { Toggle, type ToggleProps } from "./Toggle";
export { Checkbox, type CheckboxProps } from "./Checkbox";
export { Field, type FieldProps } from "./Field";
export { SearchField, type SearchFieldProps } from "./SearchField";
export { Toast, type ToastProps } from "./Toast";
export { ProgressBar, type ProgressBarProps } from "./ProgressBar";
export { RunProgressView, useRunProgress, type RunProgressViewProps } from "./RunProgress";
export { useSelection } from "./useSelection";

// Plain data and pure helpers (no "use client"), safe to import anywhere.
export { DEVICE_LABELS, DEVICE_WIDTHS, DEVICES, fitScale, type Device } from "./device";
export { fontFamilyOf, type FontChoice } from "./fonts";
export { keepListed, selectRange, selectState, toggleAll, toggleId, toggleValue, type SelectState } from "./selection";
export { describeRun } from "./run-summary";
export { contrastRatio, formatRatio, normalizeHex, readableOn, relativeLuminance, textOn, worstPair } from "./color";
export { clampPage, pageCount, pageItems, pageRange, type PageItem } from "./paging";
export { copyText } from "./clipboard";
export { leavesPage } from "./navigation";
