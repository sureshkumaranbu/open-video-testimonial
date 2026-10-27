import { ar } from "@/lib/i18n/collect/ar";
import { de } from "@/lib/i18n/collect/de";
import { en, type LabelKey } from "@/lib/i18n/collect/en";
import { es } from "@/lib/i18n/collect/es";
import { fr } from "@/lib/i18n/collect/fr";
import { hi } from "@/lib/i18n/collect/hi";
import { it } from "@/lib/i18n/collect/it";
import { nl } from "@/lib/i18n/collect/nl";
import { pl } from "@/lib/i18n/collect/pl";
import { pt } from "@/lib/i18n/collect/pt";
import { ta } from "@/lib/i18n/collect/ta";

/**
 * The step-by-step form's wording (FORM-09): one complete set per shipped
 * locale, and per-form owner overrides on top. Client-safe.
 */

export type { LabelKey };
export type Labels = Record<LabelKey, string>;

export const LOCALES = [
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
  { id: "fr", name: "Français" },
  { id: "de", name: "Deutsch" },
  { id: "pt", name: "Português" },
  { id: "it", name: "Italiano" },
  { id: "nl", name: "Nederlands" },
  { id: "pl", name: "Polski" },
  { id: "hi", name: "हिन्दी" },
  { id: "ta", name: "தமிழ்" },
  { id: "ar", name: "العربية" },
] as const;
export type Locale = (typeof LOCALES)[number]["id"];

const SETS: Record<Locale, Labels> = { en, es, fr, de, pt, it, nl, pl, hi, ta, ar };

export const LABEL_KEYS = Object.keys(en) as LabelKey[];

export function isLocale(v: string): v is Locale {
  return Object.hasOwn(SETS, v);
}

/** The locale's full set (English for one we don't ship, or "pt-BR" → pt), then the owner's overrides. Empty overrides are ignored. */
export function resolveLabels(locale: string, overrides: Partial<Record<string, string>> = {}): Labels {
  const base = SETS[isLocale(locale) ? locale : (locale.split("-")[0] as Locale)] ?? en;
  const own = Object.fromEntries(
    Object.entries(overrides).filter(([k, v]) => Object.hasOwn(en, k) && typeof v === "string" && v.trim()),
  );
  return { ...base, ...own };
}

const RTL = new Set(["ar", "he", "fa", "ur"]);

/** Arabic, Hebrew, Farsi and Urdu read right to left. */
export function dirFor(locale: string): "ltr" | "rtl" {
  return RTL.has(locale.split("-")[0].toLowerCase()) ? "rtl" : "ltr";
}

/** Fills `{project}`, `{n}`… in a label. */
export function fillLabel(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
