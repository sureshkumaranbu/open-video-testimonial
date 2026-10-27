import qrcode from "qrcode-generator";

/**
 * QR codes for forms and booster pages (FORM-11, BOOST-04), built on the
 * qrcode-generator package the share panel already used. Plain functions,
 * so the server and tests can use them too.
 *
 * With a logo in the centre the code uses the highest error correction
 * (H, which survives about 30% damage) and the logo covers at most about 5%
 * of the modules (a box 22% of the width), well inside what H recovers. The
 * modules under the logo are left out, so scanners see a clean hole.
 */

export const QUIET = 4;
export const LOGO_SHARE = 0.22;

export type QrLevel = "L" | "M" | "Q" | "H";

/** Print sizes at 300 dpi, and one for screens. */
export const QR_SIZES = [
  { id: "screen", label: "Screen (1024 px)", px: 1024, mm: null },
  { id: "3cm", label: "Sticker, 3 cm", px: 354, mm: 30 },
  { id: "6cm", label: "Table card, 6 cm", px: 709, mm: 60 },
  { id: "10cm", label: "Flyer, 10 cm", px: 1181, mm: 100 },
  { id: "20cm", label: "Poster, 20 cm", px: 2362, mm: 200 },
] as const;
export type QrSize = (typeof QR_SIZES)[number];

/** Which modules are dark, row by row. */
export function qrMatrix(text: string, level: QrLevel): boolean[][] {
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** The square (in modules, with its start) a centre logo covers: odd-sized, so it sits exactly in the middle. */
export function logoBox(n: number): { start: number; size: number } {
  let size = Math.floor(n * LOGO_SHARE);
  if (size % 2 !== n % 2) size -= 1;
  size = Math.max(size, 0);
  return { start: (n - size) / 2, size };
}

export type QrSvgOptions = {
  /** width/height attributes: a pixel number, or a print size like "60mm". */
  size?: number | string;
  /** A data: URL of the logo to put in the centre (switches to error correction H). */
  logo?: string | null;
};

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The QR code of `text` as an SVG string: dark modules in `color` on white, with a quiet zone. */
export function qrSvg(text: string, color: string, o: QrSvgOptions | number = {}) {
  const opts = typeof o === "number" ? { size: o } : o;
  const size = opts.size ?? 512;
  const m = qrMatrix(text, opts.logo ? "H" : "M");
  const n = m.length;
  const total = n + QUIET * 2;
  const box = opts.logo ? logoBox(n) : null;
  const covered = (r: number, c: number) => box !== null && r >= box.start && r < box.start + box.size && c >= box.start && c < box.start + box.size;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (m[r][c] && !covered(r, c)) path += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  }
  const logo =
    box && opts.logo
      ? `<rect x="${box.start + QUIET}" y="${box.start + QUIET}" width="${box.size}" height="${box.size}" rx="1" fill="#ffffff"/><image href="${attr(opts.logo)}" x="${box.start + QUIET + 0.5}" y="${box.start + QUIET + 0.5}" width="${box.size - 1}" height="${box.size - 1}" preserveAspectRatio="xMidYMid meet"/>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path fill="${attr(color)}" d="${path}"/>${logo}</svg>`;
}
