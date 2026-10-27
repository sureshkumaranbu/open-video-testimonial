import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { LAYOUTS } from "@/lib/widget-config";

const PUBLIC = path.resolve(__dirname, "../public");
const gz = (file: string) => zlib.gzipSync(fs.readFileSync(path.join(PUBLIC, file)), { level: 9 }).length;
/** Layouts that aren't built into the core, plus the popup form dialog. */
const LAZY = [...LAYOUTS.filter((l) => l !== "grid" && l !== "list"), "popup"];

describe("widget.js budget (D21)", () => {
  it("DISP-11 the core (grid and list) is at most 7,168 bytes gzipped", () => {
    expect(gz("widget.js")).toBeLessThanOrEqual(7168);
  });

  it("DISP-11 the core plus its largest layout file is at most 15,360 bytes gzipped", () => {
    const core = gz("widget.js");
    // The slider and carousel files each carry the shared track, so one file is all a page loads.
    const largest = Math.max(...LAZY.map((l) => gz(`widget/${l}.js`)));
    expect(core + largest).toBeLessThanOrEqual(15360);
  });

  it("DISP-11 every layout has its lazy file, and each registers itself", () => {
    for (const l of LAZY) {
      const src = fs.readFileSync(path.join(PUBLIC, "widget", `${l}.js`), "utf8");
      expect(src).toContain(`W.layouts.${l} = function`);
      expect(src).toContain(`W.loaded("${l}")`);
    }
  });

  it("DISP-04 carousel.js and slider.js carry identical copies of the shared track", () => {
    const track = (f: string) => {
      const s = fs.readFileSync(path.join(PUBLIC, "widget", f), "utf8");
      return s.slice(s.indexOf("// TRACK START"), s.indexOf("// TRACK END"));
    };
    expect(track("carousel.js").length).toBeGreaterThan(500);
    expect(track("slider.js")).toBe(track("carousel.js"));
  });

  it("DISP-11 widget files are plain ASCII, so a host page's charset can't garble them", () => {
    for (const f of ["widget.js", ...LAZY.map((l) => `widget/${l}.js`)]) {
      expect(/[^\x00-\x7f]/.test(fs.readFileSync(path.join(PUBLIC, f), "utf8")), f).toBe(false);
    }
  });
});
