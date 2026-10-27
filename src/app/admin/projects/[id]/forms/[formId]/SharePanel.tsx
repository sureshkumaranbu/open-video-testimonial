"use client";

import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { ColorField, CopyField } from "@/components/admin";
import type { FormRow } from "../types";

const QUIET = 4;

/** The QR code of `text` as an SVG string: dark modules in `color` on white, with a quiet zone. */
export function qrSvg(text: string, color: string, size = 512) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const total = n + QUIET * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path fill="${color}" d="${path}"/></svg>`;
}

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

/** Draws the SVG on a canvas and saves it as PNG (made in the browser; nothing is uploaded). */
async function downloadPng(name: string, svg: string, size: number) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The QR code couldn't be drawn"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d")!.drawImage(img, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (blob) download(name, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** FORM-11: the hosted link, a QR code (PNG or SVG, any colour) and the three ways to embed the form. */
export function SharePanel({ form, accent }: { form: FormRow; accent: string }) {
  const [color, setColor] = useState("#161b2e");
  const svg = useMemo(() => qrSvg(form.links.hosted, color || "#161b2e"), [form.links.hosted, color]);
  const preview = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);
  return (
    <div className="stack fb-editor" data-testid="share-panel">
      <h2 className="section-title">Link</h2>
      <CopyField label="Hosted link" value={form.links.hosted} testId="share-link" />
      {form.status === "paused" && <p className="notice small">The form is paused: the link shows its closed message.</p>}

      <h2 className="section-title">QR code</h2>
      <div className="row" style={{ gap: "var(--space-4)", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt={`QR code for ${form.links.hosted}`} width={160} height={160} className="fb-qr" data-testid="qr-preview" />
        <div className="stack" style={{ gap: "var(--space-2)", flex: "1 1 180px" }}>
          <ColorField label="Colour" value={color} onChange={(hex) => setColor(hex || "#161b2e")} placeholder={accent} contrastWith="#ffffff" minContrast={3} />
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="secondary small" onClick={() => void downloadPng(`${form.slug}-qr.png`, svg, 1024)} data-testid="qr-png">
              Download PNG
            </button>
            <button type="button" className="secondary small" onClick={() => download(`${form.slug}-qr.svg`, new Blob([svg], { type: "image/svg+xml" }))} data-testid="qr-svg">
              Download SVG
            </button>
          </div>
        </div>
      </div>

      <h2 className="section-title">Embed</h2>
      <CopyField label="Inline on your page" value={form.links.inline} multiline rows={3} testId="embed-inline" hint="The form appears where you paste this." />
      <CopyField label="Popup button" value={form.links.popup} multiline rows={3} testId="embed-popup" hint="A floating button that opens the form." />
      <CopyField label="Iframe" value={form.links.iframe} multiline rows={3} testId="embed-iframe" hint="For site builders that only take an iframe." />
    </div>
  );
}
