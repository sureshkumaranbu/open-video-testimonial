import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { DEFAULT_THEME, isTheme, previewTheme, THEMES, themeOr } from "@/lib/themes";

describe("brand themes", () => {
  const saved = process.env.PLAUDIT_THEME;
  afterEach(() => {
    if (saved === undefined) delete process.env.PLAUDIT_THEME;
    else process.env.PLAUDIT_THEME = saved;
  });

  it("PLAUDIT_THEME picks the theme, defaulting to violet", () => {
    delete process.env.PLAUDIT_THEME;
    expect(env.theme).toBe("violet");
    process.env.PLAUDIT_THEME = "tomato";
    expect(env.theme).toBe("tomato");
    process.env.PLAUDIT_THEME = "  Teal ";
    expect(env.theme).toBe("teal");
    process.env.PLAUDIT_THEME = "neon";
    expect(env.theme).toBe(DEFAULT_THEME);
  });

  it("?theme= previews a known theme and ignores anything else", () => {
    expect(previewTheme("tomato", "teal")).toBe("tomato");
    expect(previewTheme(["ink", "violet"], "teal")).toBe("ink");
    expect(previewTheme(undefined, "teal")).toBe("teal");
    expect(previewTheme("dark", "teal")).toBe("teal"); // globals.css's data-theme="dark" is not a brand
    expect(previewTheme('"><script>', "violet")).toBe("violet");
    expect(isTheme("constructor")).toBe(false);
    expect(themeOr(42)).toBe("violet");
  });

  it("every theme has exactly one block in theme.css, with a dark variant", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "src", "app", "theme.css"), "utf8");
    for (const name of THEMES) {
      const blocks = css.split(`[data-theme="${name}"] {`);
      expect(blocks, name).toHaveLength(2);
      const block = blocks[1].slice(0, blocks[1].indexOf("\n}\n"));
      expect(block, name).toMatch(/--primary:/);
      expect(block, name).toMatch(/--primary-foreground:/);
      expect(block, name).toMatch(/--ring:/);
      expect(block, name).toMatch(/&:is\(\.dark, \.dark \*\) \{[^}]*--primary:/);
    }
  });
});
