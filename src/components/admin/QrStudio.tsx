"use client";

import { useEffect, useMemo, useState } from "react";
import { ColorField } from "./ColorField";
import { logoBox, qrMatrix, qrSvg, QR_SIZES, QUIET, type QrSize } from "./qr";
import "@/app/admin/admin-kit.css";

/**
 * A QR code for a link (FORM-11, BOOST-04): any colour, an optional logo in
 * the centre (then error correction H), and print sizes at 300 dpi. PNG and
 * SVG are made in the browser; nothing is uploaded. The SVG carries its
 * print size in millimetres and embeds the logo, so it works on its own.
 */
export type QrStudioProps = {
  url: string;
  /** Downloads are <fileBase>-qr.png and .svg. */
  fileBase: string;
  /** A same-origin image that can go in the centre (the form's, booster's or project's logo). */
  logoUrl?: string | null;
  /** The colour picker's suggestion (the brand colour). */
  suggestion?: string;
};

const DEFAULT_COLOR = "#161b2e";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The logo couldn't be loaded"));
    img.src = src;
  });
}

/** The logo as a data: URL, so the SVG file carries it. */
async function asDataUrl(src: string): Promise<string> {
  const res = await fetch(src, { credentials: "same-origin" });
  if (!res.ok) throw new Error("The logo couldn't be loaded");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The logo couldn't be read"));
    reader.readAsDataURL(blob);
  });
}

/** Draws the code module by module (crisp at any size), then the logo. */
async function downloadPng(name: string, text: string, color: string, px: number, logoUrl: string | null) {
  const m = qrMatrix(text, logoUrl ? "H" : "M");
  const n = m.length;
  const total = n + QUIET * 2;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  const at = (i: number) => Math.round((i * px) / total);
  const box = logoUrl ? logoBox(n) : null;
  const covered = (r: number, c: number) => box !== null && r >= box.start && r < box.start + box.size && c >= box.start && c < box.start + box.size;
  ctx.fillStyle = color;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r][c] || covered(r, c)) continue;
      const x = at(c + QUIET);
      const y = at(r + QUIET);
      ctx.fillRect(x, y, at(c + QUIET + 1) - x, at(r + QUIET + 1) - y);
    }
  }
  if (box && logoUrl) {
    const img = await loadImage(logoUrl);
    const x = at(box.start + QUIET);
    const w = at(box.start + QUIET + box.size) - x;
    const pad = Math.round(w / Math.max(box.size, 1) / 2);
    const inner = w - pad * 2;
    const scale = Math.min(inner / img.naturalWidth, inner / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, x + pad + (inner - dw) / 2, x + pad + (inner - dh) / 2, dw, dh);
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (blob) download(name, blob);
}

export function QrStudio({ url, fileBase, logoUrl, suggestion }: QrStudioProps) {
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [withLogo, setWithLogo] = useState(false);
  const [sizeId, setSizeId] = useState<QrSize["id"]>("screen");
  const [logoData, setLogoData] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = QR_SIZES.find((s) => s.id === sizeId) ?? QR_SIZES[0];
  const useLogo = withLogo && Boolean(logoUrl);

  useEffect(() => {
    if (!useLogo || !logoUrl) return;
    let live = true;
    asDataUrl(logoUrl)
      .then((d) => live && setLogoData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [useLogo, logoUrl]);

  const logo = useLogo ? logoData : null;
  const svg = useMemo(() => qrSvg(url, color || DEFAULT_COLOR, { size: size.mm ? `${size.mm}mm` : size.px, logo }), [url, color, size, logo]);
  const preview = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(url, color || DEFAULT_COLOR, { size: 160, logo }))}`, [url, color, logo]);

  return (
    <div className="ak-qr" data-testid="qr-studio">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview} alt={`QR code for ${url}`} width={160} height={160} className="ak-qr-img fb-qr" data-testid="qr-preview" data-logo={logo ? "true" : undefined} />
      <div className="stack" style={{ gap: "var(--space-2)", flex: "1 1 200px" }}>
        <ColorField label="Colour" value={color} onChange={(hex) => setColor(hex || DEFAULT_COLOR)} placeholder={suggestion} contrastWith="#ffffff" minContrast={3} />
        {logoUrl ? (
          <label className="check small">
            <input type="checkbox" checked={withLogo} onChange={(e) => setWithLogo(e.target.checked)} data-testid="qr-logo" />
            Logo in the centre
          </label>
        ) : (
          <p className="muted xsmall">Upload a logo to put it in the centre of the code.</p>
        )}
        <label>
          Size
          <select value={sizeId} onChange={(e) => setSizeId(e.target.value as QrSize["id"])} data-testid="qr-size">
            {QR_SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            data-testid="qr-png"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await downloadPng(`${fileBase}-qr.png`, url, color || DEFAULT_COLOR, size.px, useLogo ? logoUrl! : null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Download PNG
          </button>
          <button type="button" className="secondary small" onClick={() => download(`${fileBase}-qr.svg`, new Blob([svg], { type: "image/svg+xml" }))} data-testid="qr-svg">
            Download SVG
          </button>
        </div>
        <p className="muted xsmall">
          {useLogo ? "With a logo the code uses the strongest error correction, so it still scans. " : ""}
          Scan it with a phone camera before you print it. Dark colours on white scan best.
        </p>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
