/** Preview sizes for builders (DevicePreview). Plain data, so server code can read it too. */

/** Preview widths for builders. */
export const DEVICE_WIDTHS = { desktop: 1200, tablet: 768, mobile: 375 } as const;
export type Device = keyof typeof DEVICE_WIDTHS;

export const DEVICES = Object.keys(DEVICE_WIDTHS) as Device[];
export const DEVICE_LABELS: Record<Device, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

/** How far a frame `width` wide must shrink to fit `available` (never grows). */
export function fitScale(width: number, available: number) {
  if (!(available > 0) || !(width > 0)) return 1;
  return Math.min(1, available / width);
}
