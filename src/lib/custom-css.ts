/**
 * DISP-08: the owner's own CSS for a widget, applied inside the widget's
 * shadow root only (widget.js appends it after its own styles, as text). It
 * is cleaned so it can never leave its <style> element or make a widget ask
 * anyone but this server for anything:
 *   - "<!--", "-->", every "<" and then comments go (so no "</style", and
 *     nothing removed later can open a comment);
 *   - backslash escapes outside strings go (so "@\69mport" or "u\72l(" can't spell a fetch);
 *   - @import goes, again until none is left (so "@im@import x;port" can't rebuild one);
 *   - url() stays only for this server's own files ("/…" or its own address,
 *     kept as "/…" so a new address still works); anything else becomes `none`;
 *   - image-set(), image() and src() (which fetch without url()) are made invalid.
 * No Node APIs: the studio shows the cleaned CSS with the same function.
 */

/** The most CSS a widget keeps, in characters. */
export const MAX_CUSTOM_CSS = 10_000;

/** Removes backslashes outside quoted strings; inside one, an escape pair is kept as it is. */
function dropEscapes(css: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") {
        out += c + (css[i + 1] ?? "");
        i++;
        continue;
      }
      if (c === quote || c === "\n") quote = null;
      out += c;
      continue;
    }
    if (c === "\\") continue;
    if (c === '"' || c === "'") quote = c;
    out += c;
  }
  return out;
}

const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9._~/%?=&+,;:@!$*-]*$/;

/** A url() value that points at this server: "/path", "#id", or `origin` + "/path" (returned as "/path"). Null otherwise. */
function ownUrl(value: string, origin: string): string | null {
  const v = value.trim();
  if (/^#[A-Za-z][\w-]*$/.test(v)) return v;
  if (SAFE_PATH.test(v)) return v;
  const o = origin.replace(/\/+$/, "");
  if (o && v.toLowerCase().startsWith(`${o.toLowerCase()}/`)) {
    const rest = v.slice(o.length);
    return SAFE_PATH.test(rest) ? rest : null;
  }
  return null;
}

const URL_CALL = /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^"'()\s]*))\s*\)/gi;

/**
 * The cleaned CSS (see the file comment). `origin` is this server's public
 * address, so `url(https://this-server/…)` is kept. Throws nothing; input
 * past the cap is cut first, and the result is never longer than the cap.
 */
export function sanitizeCss(input: string, o: { origin?: string } = {}): string {
  let css = String(input ?? "").slice(0, MAX_CUSTOM_CSS * 2).replace(/\u0000/g, "");
  css = css.replace(/<!--|-->/g, "").replace(/</g, "");
  css = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
  css = dropEscapes(css);
  for (let prev = ""; prev !== css; ) {
    prev = css;
    css = css.replace(/@import\b[^;{}]*;?/gi, "");
  }
  css = css.replace(/(-webkit-)?image-set\s*\(/gi, "blocked-image-set(");
  css = css.replace(/(^|[^\w-])image\s*\(/gi, "$1blocked-image(");
  css = css.replace(/(^|[^\w-])src\s*\(/gi, "$1blocked-src(");
  const kept: string[] = [];
  css = css.replace(URL_CALL, (_m, a: string | undefined, b: string | undefined, c: string | undefined) => {
    const ok = ownUrl(a ?? b ?? c ?? "", o.origin ?? "");
    if (!ok) return "none";
    kept.push(ok);
    return `\u0000${kept.length - 1}\u0000`;
  });
  // Whatever still looks like url( didn't parse as one we keep.
  css = css.replace(/url\s*\(/gi, "blocked-url(");
  css = css.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `url("${kept[Number(i)]}")`);
  return css.trim().slice(0, MAX_CUSTOM_CSS);
}

/** The CSS as a widget gets it: cleaned again, with "/…" made absolute against this server (the host page's would be wrong). */
export function cssForWidget(css: string, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return sanitizeCss(css, { origin: base }).replace(/url\("\/(?!\/)/g, `url("${base}/`);
}
