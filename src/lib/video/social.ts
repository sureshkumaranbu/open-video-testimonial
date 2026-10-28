import { textOn } from "../contrast";
import { captionsAss, highlightOf, type Brand, type Canvas, type CaptionStyle, type Fit, type Layer } from "./compose";
import type { SocialLook } from "./looks";
import type { Word } from "./words";

/**
 * VID-07's four looks, and the name tag reels use (VID-08). Each look is a
 * fit for the video plus layers drawn over it; sizes are worked out from the
 * canvas, so the same look serves 9:16 and 1:1. All of it is our own design.
 */
export type Person = { name: string; detail: string | null };

const charW = 0.56;

/** A brand-colour pill holding the name (and a smaller line under it). */
function nameTag(brand: Brand, person: Person, x: number, y: number, size: number, maxW: number, alpha = 0.92): Layer[] {
  const sub = Math.round(size * 0.66);
  const pad = Math.round(size * 0.55);
  const nameChars = Math.max(4, Math.floor((maxW - pad * 2) / (size * charW)));
  const subChars = Math.max(4, Math.floor((maxW - pad * 2) / (sub * charW)));
  const name = person.name.length > nameChars ? `${person.name.slice(0, nameChars - 1)}…` : person.name;
  const detail = person.detail ? (person.detail.length > subChars ? `${person.detail.slice(0, subChars - 1)}…` : person.detail) : null;
  const w = Math.min(maxW, Math.round(Math.max(name.length * size * charW, (detail?.length ?? 0) * sub * charW) + pad * 2));
  const h = Math.round(size * 1.2 + (detail ? sub * 1.3 : 0) + pad * 1.2);
  const fg = textOn(brand.color, "#111111");
  return [
    { type: "box", x, y, w, h, color: brand.color, alpha },
    { type: "text", text: name, x: x + pad, y: y + Math.round(pad * 0.7), size, color: fg },
    ...(detail ? [{ type: "text" as const, text: detail, x: x + pad, y: y + Math.round(pad * 0.7 + size * 1.25), size: sub, color: fg }] : []),
  ];
}

export type LookPlan = { fit: Fit; background: string; layers: Layer[] };

/**
 * What a look draws for one clip. `words` are already in the clip's own
 * time (0 = its first frame); null or empty draws no captions.
 */
export function socialLook(look: SocialLook, canvas: Canvas, brand: Brand, person: Person | null, words: Word[] | null, o: { logo: boolean }): LookPlan {
  const { w: W, h: H } = canvas;
  const s = W / 1080;
  const tall = H > W;
  const hi = highlightOf(brand.color);
  const onBrand = textOn(brand.color, "#111111");
  const layers: Layer[] = [];
  const caption = (style: CaptionStyle) => {
    if (words?.length) layers.push({ type: "captions", ass: captionsAss(canvas, words, style) });
  };
  const logo = (x: number | "right", y: number, h: number, margin?: number) => {
    if (o.logo && brand.logo) layers.push({ type: "logo", file: brand.logo, x, y, h, margin });
  };

  if (look === "studio") {
    const bar = Math.round(H * (tall ? 0.12 : 0.15));
    layers.push({ type: "box", x: 0, y: H - bar, w: W, h: bar, color: brand.color, alpha: 0.96 });
    if (person) {
      const size = Math.round(52 * s);
      layers.push({ type: "text", text: person.name, x: Math.round(56 * s), y: H - bar + Math.round(bar * (person.detail ? 0.2 : 0.34)), size, color: onBrand });
      if (person.detail) layers.push({ type: "text", text: person.detail, x: Math.round(56 * s), y: H - bar + Math.round(bar * 0.2 + size * 1.35), size: Math.round(34 * s), color: onBrand });
    }
    logo(Math.round(48 * s), Math.round(48 * s), Math.round(W * 0.09));
    caption({ size: 64 * s, per: 5, upper: false, color: "#ffffff", active: hi, edge: "#000000", edgeWidth: 4 * s, align: 2, marginV: bar + 56 * s, marginH: 70 * s });
    return { fit: "cover", background: "#000000", layers };
  }

  if (look === "frame") {
    const m = Math.round(60 * s);
    const box = tall ? { x: m, y: Math.round(220 * s), w: W - m * 2, h: Math.round(1080 * s) } : { x: m, y: Math.round(50 * s), w: W - m * 2, h: Math.round(620 * s) };
    let y = box.y + box.h + Math.round(36 * s);
    if (person) {
      const size = Math.round((tall ? 50 : 42) * s);
      layers.push({ type: "text", text: person.name, x: "center", y, size, color: onBrand });
      y += Math.round(size * 1.3);
      if (person.detail) {
        layers.push({ type: "text", text: person.detail, x: "center", y, size: Math.round(size * 0.68), color: onBrand });
        y += Math.round(size * 0.68 * 1.4);
      }
    }
    if (tall) logo("right", Math.round(70 * s), Math.round(90 * s), m);
    else logo("right", box.y + Math.round(20 * s), Math.round(70 * s), m + Math.round(20 * s));
    caption({
      size: (tall ? 58 : 44) * s,
      per: tall ? 5 : 6,
      upper: false,
      color: onBrand,
      active: onBrand,
      edge: brand.color,
      edgeWidth: 0,
      align: tall ? 8 : 2,
      marginV: tall ? y + 24 * s : 40 * s,
      marginH: 80 * s,
      underline: true,
      dim: 0.55,
    });
    return { fit: { box }, background: brand.color, layers };
  }

  if (look === "bold") {
    layers.push({ type: "box", x: 0, y: 0, w: W, h: Math.round(14 * s), color: brand.color });
    if (person) layers.push(...nameTag(brand, { name: person.name, detail: null }, Math.round(48 * s), Math.round(72 * s), Math.round(40 * s), W * 0.6));
    logo("right", Math.round(64 * s), Math.round(W * 0.08), Math.round(48 * s));
    caption({ size: (tall ? 96 : 80) * s, per: 3, upper: true, color: "#ffffff", active: hi, edge: "#000000", edgeWidth: 7 * s, align: 2, marginV: tall ? H * 0.3 : H * 0.12, marginH: 60 * s });
    return { fit: "cover", background: "#000000", layers };
  }

  // soft
  if (person) layers.push(...nameTag(brand, person, Math.round(48 * s), Math.round(56 * s), Math.round(40 * s), W * 0.7, 0.85));
  logo("right", Math.round(56 * s), Math.round(W * 0.08), Math.round(48 * s));
  caption({ size: (tall ? 54 : 46) * s, per: 6, upper: false, color: "#ffffff", active: hi, edge: "#000000", edgeWidth: 16 * s, box: 0.55, align: 2, marginV: (tall ? 150 : 60) * s, marginH: 90 * s });
  return { fit: "blur", background: "#000000", layers };
}

/** VID-08: a reel clip's name tag (bottom left) and, when asked for, captions above it. */
export function reelClipLayers(canvas: Canvas, brand: Brand, person: Person, words: Word[] | null): Layer[] {
  const { w: W, h: H } = canvas;
  const s = Math.min(W, H) / 720;
  const size = Math.round(30 * s);
  const tag = nameTag(brand, person, Math.round(40 * s), 0, size, W * 0.7);
  const tagH = (tag[0] as { h: number }).h;
  const y = H - tagH - Math.round(40 * s);
  for (const l of tag) if (l.type === "box" || l.type === "text") l.y += y;
  const layers: Layer[] = [...tag];
  if (words?.length) {
    layers.push({
      type: "captions",
      ass: captionsAss(canvas, words, { size: 36 * s, per: W > H ? 7 : 5, upper: false, color: "#ffffff", active: highlightOf(brand.color), edge: "#000000", edgeWidth: 3 * s, align: 2, marginV: H - y + 24 * s, marginH: 60 * s }),
    });
  }
  return layers;
}
