import { describe, expect, it } from "vitest";
import { dirFor, LABEL_KEYS, LOCALES, resolveLabels } from "@/lib/forms/labels";
import { en } from "@/lib/i18n/collect/en";

describe("form labels", () => {
  it("FORM-09 ships all 11 locales, each complete and with the same placeholders", () => {
    expect(LOCALES.map((l) => l.id)).toEqual(["en", "es", "fr", "de", "pt", "it", "nl", "pl", "hi", "ta", "ar"]);
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const { id } of LOCALES) {
      const set = resolveLabels(id);
      expect(Object.keys(set).sort()).toEqual([...LABEL_KEYS].sort());
      for (const key of LABEL_KEYS) {
        // recTooLarge may be empty in English (the shared wording is used).
        if (!(id === "en" && key === "recTooLarge")) expect(set[key], `${id}.${key}`).not.toBe("");
        if (en[key]) expect(placeholders(set[key]), `${id}.${key}`).toEqual(placeholders(en[key]));
      }
    }
  });

  it("FORM-09 changing the language swaps every default string", () => {
    const es = resolveLabels("es");
    const same = LABEL_KEYS.filter((k) => es[k] === en[k] && !/^(social|recMinutesSeconds|answerVideo|recOneMinute)/.test(k));
    expect(same).toEqual([]);
    expect(resolveLabels("pt-BR").next).toBe(resolveLabels("pt").next);
    expect(resolveLabels("xx").next).toBe(en.next);
  });

  it("FORM-09 owner overrides win; empty and unknown ones are ignored", () => {
    const l = resolveLabels("fr", { next: "On y va", back: "  ", bogus: "x" });
    expect(l.next).toBe("On y va");
    expect(l.back).toBe(resolveLabels("fr").back);
    expect("bogus" in l).toBe(false);
  });

  it("FORM-09 Arabic, Hebrew and Farsi read right to left", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("he")).toBe("rtl");
    expect(dirFor("fa-IR")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(dirFor("ta")).toBe("ltr");
  });
});
