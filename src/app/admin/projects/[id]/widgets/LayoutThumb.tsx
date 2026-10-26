import type { WidgetLayout } from "@/db/schema";

/** Boxes (left, top, width, height in %) that sketch each layout. Our own drawings. */
const SHAPES: Record<WidgetLayout, [number, number, number, number][]> = {
  grid: [[8, 12, 26, 40], [37, 12, 26, 60], [66, 12, 26, 32], [8, 56, 26, 32], [66, 48, 26, 40]],
  list: [[20, 10, 60, 22], [20, 39, 60, 22], [20, 68, 60, 22]],
  carousel: [[22, 14, 56, 62], [6, 38, 8, 14], [86, 38, 8, 14], [44, 82, 12, 6]],
  slider: [[4, 18, 28, 60], [36, 18, 28, 60], [68, 18, 28, 60]],
  marquee: [[-6, 14, 30, 30], [28, 14, 30, 30], [62, 14, 30, 30], [10, 56, 30, 30], [44, 56, 30, 30], [78, 56, 30, 30]],
  featured: [[14, 14, 72, 54], [38, 74, 24, 10]],
  badge: [[18, 32, 64, 36]],
  toast: [[6, 54, 46, 36]],
};

export function LayoutThumb({ layout }: { layout: WidgetLayout }) {
  return (
    <span className="ws-thumb" aria-hidden="true" data-layout={layout}>
      {SHAPES[layout].map(([l, t, w, h], i) => (
        <i key={i} style={{ left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%` }} />
      ))}
    </span>
  );
}
