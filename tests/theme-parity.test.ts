import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accentStyle } from "@/lib/theme";
import { defaultWidgetConfig, toPublicWidget } from "@/lib/widgets";

const root = path.resolve(__dirname, "..");
const globals = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const widget = fs.readFileSync(path.join(root, "public/widget.js"), "utf8");

/** The custom properties declared in the first block matching `selector`. */
function tokens(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
}

/** The widget's palette strings, as custom properties. */
function widgetVars(chunk: string) {
  return Object.fromEntries([...chunk.matchAll(/--([a-z-]+):([^;"]+)/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
}

const hex6 = (v: string) => (v === "#fff" ? "#ffffff" : v);

describe("widget palette parity with globals.css", () => {
  const light = tokens(globals, ":root");
  const dark = { ...light, ...tokens(globals, '[data-theme="dark"]') };
  const lightW = widgetVars(widget.slice(widget.indexOf('".w{--card'), widget.indexOf("font-family:ui-sans-serif")));
  const darkW = widgetVars(widget.slice(widget.indexOf('var DARK = "'), widget.indexOf("\n", widget.indexOf('var DARK = "'))));
  const MAP: Record<string, string> = { card: "surface", text: "ink", muted: "ink-2", border: "line", star: "star", "star-off": "star-off", stage: "stage" };

  it("DISP-03 light theme matches the app's tokens", () => {
    for (const [w, app] of Object.entries(MAP)) {
      expect(light[app], app).toMatch(/^#[0-9a-f]{6}$/);
      expect(hex6(lightW[w]), w).toBe(light[app]);
    }
  });

  it("DISP-03 dark theme matches the app's dark tokens", () => {
    for (const w of ["card", "text", "muted", "border", "star-off"]) {
      expect(darkW[w], w).toMatch(/^#[0-9a-f]{6}$/);
      expect(hex6(darkW[w]), w).toBe(dark[MAP[w]]);
    }
  });
});

describe("text on the accent colour", () => {
  const BRANDS = ["#0f766e", "#e2463f", "#3d63dd", "#f2a93b", "#161b2e", "#ffffff", "#22c55e", "#facc15", "#8b5cf6", "#0ea5e9", "#a3e635"];

  it("DISP-03 saved widgets use the app's formula (theme.ts), computed on the server", () => {
    for (const accent of BRANDS) {
      const cfg = defaultWidgetConfig();
      cfg.design.accent = accent;
      const pub = toPublicWidget({ id: "w_000000000000" }, cfg, { cta: null, wallUrl: "/wall/x" });
      expect(pub.design.onAccent, accent).toBe(accentStyle(accent)["--on-accent"]);
    }
    const fallback = toPublicWidget({ id: "w_000000000000" }, defaultWidgetConfig(), { cta: null, wallUrl: "/", projectAccent: "#facc15" });
    expect(fallback.design).toMatchObject({ accent: "#facc15", onAccent: "#161b2e" });
  });

  it("DISP-03 the data-project embed keeps its own formula unchanged, which agrees on clear-cut colours", () => {
    // widget.js's original perceived-brightness check, kept as is so data-project output never changes.
    const legacy = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 160 ? "#161b2e" : "#ffffff";
    };
    expect(widget).toContain("return lum > 160 ? \"#161b2e\" : \"#fff\";");
    for (const accent of ["#0f766e", "#e2463f", "#3d63dd", "#161b2e", "#ffffff", "#facc15", "#f2a93b"])
      expect(legacy(accent), accent).toBe(accentStyle(accent)["--on-accent"]);
  });
});
