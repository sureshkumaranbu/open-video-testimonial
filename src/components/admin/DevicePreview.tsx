"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEVICE_LABELS, DEVICE_WIDTHS, DEVICES, fitScale, type Device } from "./device";
import { Segmented } from "./Segmented";
import "@/app/admin/admin-kit.css";

/**
 * Shows its children at a device's width, with a desktop / tablet / mobile
 * switch when `onDevice` is given. The children lay out at the real width
 * (container queries see 1200 px for desktop) and the frame is scaled down
 * to fit the space it has, so a desktop preview fits a laptop-sized builder.
 */
export type DevicePreviewProps = {
  device: Device;
  onDevice?: (d: Device) => void;
  label?: string;
  children: ReactNode;
  testId?: string;
};

export function DevicePreview({ device, onDevice, label = "Preview", children, testId }: DevicePreviewProps) {
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ available: 0, height: 0 });
  const width = DEVICE_WIDTHS[device];

  useEffect(() => {
    const s = stage.current;
    const f = frame.current;
    if (!s || !f || typeof ResizeObserver === "undefined") return;
    const measure = () => setBox({ available: s.clientWidth, height: f.offsetHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    ro.observe(f);
    measure();
    return () => ro.disconnect();
  }, []);

  const scale = fitScale(width, box.available);
  const scaled = scale < 1;

  return (
    <div className="ak-device" data-device={device} data-testid={testId}>
      {onDevice && (
        <Segmented
          label={`${label} size`}
          options={DEVICES.map((d) => ({ value: d, label: DEVICE_LABELS[d] }))}
          value={device}
          onChange={onDevice}
          className="ak-device-switch"
        />
      )}
      <div
        ref={stage}
        className="ak-device-stage"
        role="group"
        aria-label={`${label}, ${DEVICE_LABELS[device].toLowerCase()} width (${width} px)`}
        style={scaled && box.height ? { height: Math.ceil(box.height * scale) } : undefined}
      >
        <div
          ref={frame}
          className="ak-device-frame"
          data-scale={scale.toFixed(3)}
          style={{ width, transform: scaled ? `scale(${scale})` : undefined }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
