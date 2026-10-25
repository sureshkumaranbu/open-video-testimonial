import { describe, expect, it } from "vitest";
import { classicCompatible } from "@/lib/forms/defaults";
import { fontFaceCss, FONT_CHOICES, formDesignStyle } from "@/lib/forms/design";
import { visiblePages } from "@/lib/forms/engine";
import { formDesignSchema, formPagesSchema } from "@/lib/forms/schema";
import { FORM_TEMPLATES, getTemplate } from "@/lib/forms/templates";

describe("form templates", () => {
  it("FORM-18 ships the 8 presets, each a valid step-by-step form", () => {
    expect(FORM_TEMPLATES.map((t) => t.id)).toEqual(["saas", "course", "coaching", "agency", "ecommerce", "local", "employee", "event"]);
    for (const t of FORM_TEMPLATES) {
      const cfg = t.build("Acme");
      expect(formPagesSchema.safeParse(cfg.pages).success, t.id).toBe(true);
      expect(cfg.layout).toBe("steps");
      expect(classicCompatible(cfg), t.id).toBe(false);
      const questions = cfg.pages.filter((p) => p.type === "question");
      expect(questions.length).toBeGreaterThan(0);
      expect(questions.filter((q) => q.type === "question" && q.primary)).toHaveLength(1);
      expect(visiblePages(cfg).some((p) => p.type === "welcome")).toBe(true);
    }
  });

  it("FORM-18 puts the project's name into the wording", () => {
    const cfg = getTemplate("saas")!.build("Acme");
    const text = JSON.stringify(cfg.pages);
    expect(text).toContain("Acme");
    expect(text).not.toContain("{project}");
    expect(getTemplate("nope")).toBeNull();
  });
});

describe("form design", () => {
  it("FORM-08 turns the design into custom properties, falling back to the project colour", () => {
    const style = formDesignStyle(formDesignSchema.parse({}), "#3355ff");
    expect(style["--fr-primary"]).toBe("#3355ff");
    expect(style["--accent"]).toBe("#3355ff");
    expect(style["--on-accent"]).toBe("#ffffff");
    const own = formDesignStyle(formDesignSchema.parse({ primary: "#ffee00", theme: "dark", radius: 4, width: "compact" }), "#000000");
    expect(own).toMatchObject({ "--fr-primary": "#ffee00", "--on-accent": "#161b2e", "--fr-radius": "4px", "--fr-width": "520px" });
    expect(own["--fr-bg"]).not.toBe(style["--fr-bg"]);
  });

  it("FORM-08 self-hosts fonts: @font-face only for files under /fonts", () => {
    expect(fontFaceCss({ headingFont: "geist", bodyFont: "system" })).toContain('url(/fonts/geist-latin.woff2)');
    expect(fontFaceCss({ headingFont: "system" })).toBe("");
    for (const f of FONT_CHOICES) if (f.file) expect(f.file.startsWith("/fonts/")).toBe(true);
  });
});
