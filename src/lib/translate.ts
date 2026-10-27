import { env } from "./env";
import { ProviderError, providerJson } from "./provider-fetch";

/**
 * Machine translation through the owner's own provider (INBOX-13):
 * DeepL, LibreTranslate, or any OpenAI-compatible chat endpoint, with their
 * own key. Off unless TRANSLATE_PROVIDER is set; called from the server only,
 * and never while a public page is being served.
 */

export { ProviderError };

export function translationEnabled() {
  const p = env.translateProvider;
  if (p === "off" || !env.translateApiUrl) return false;
  if (p === "openai") return Boolean(env.translateModel);
  if (p === "deepl") return Boolean(env.translateApiKey);
  return true;
}

/** The provider's name for the dashboard ("DeepL"), or null when translation is off. */
export function translationProviderName(): string | null {
  if (!translationEnabled()) return null;
  return { deepl: "DeepL", libretranslate: "LibreTranslate", openai: "your AI provider" }[env.translateProvider as "deepl" | "libretranslate" | "openai"];
}

/** DeepL's target codes: upper case, with the regions it insists on for English and Portuguese. */
function deeplTarget(lang: string) {
  const l = lang.toUpperCase();
  if (l === "EN") return "EN-GB";
  if (l === "PT") return "PT-PT";
  return l;
}

type Obj = Record<string, unknown>;

/**
 * Translates each text into `target` (a BCP 47 code such as "fr" or
 * "pt-br"), keeping their order. Empty strings stay empty and aren't sent.
 */
export async function translateTexts(texts: string[], target: string, source?: string | null): Promise<string[]> {
  if (!translationEnabled()) throw new ProviderError("Translation isn't set up on this server (TRANSLATE_PROVIDER)");
  const idx = texts.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);
  const out = texts.map(() => "");
  if (!idx.length) return out;
  const send = idx.map((i) => texts[i]);
  const base = env.translateApiUrl;
  const key = env.translateApiKey;
  let got: string[];
  if (env.translateProvider === "deepl") {
    const json = (await providerJson(
      `${base}/v2/translate`,
      { text: send, target_lang: deeplTarget(target), ...(source ? { source_lang: source.split("-")[0].toUpperCase() } : {}) },
      { headers: { Authorization: `DeepL-Auth-Key ${key}` } },
    )) as Obj;
    got = Array.isArray(json.translations) ? (json.translations as Obj[]).map((t) => String(t.text ?? "")) : [];
  } else if (env.translateProvider === "libretranslate") {
    const json = (await providerJson(`${base}/translate`, { q: send, source: source ? source.split("-")[0] : "auto", target: target.split("-")[0], format: "text", ...(key ? { api_key: key } : {}) })) as Obj;
    const t = json.translatedText;
    got = Array.isArray(t) ? t.map(String) : typeof t === "string" && send.length === 1 ? [t] : [];
  } else {
    const json = (await providerJson(
      `${base}/chat/completions`,
      {
        model: env.translateModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You translate customer testimonials into the language with the BCP 47 code "${target}". Keep the meaning, tone and line breaks; translate nothing else and add nothing. You get a JSON array of strings; answer with only a JSON array of their translations, in the same order.`,
          },
          { role: "user", content: JSON.stringify(send) },
        ],
      },
      { headers: key ? { Authorization: `Bearer ${key}` } : {}, timeoutMs: 60_000 },
    )) as Obj;
    const content = String(((json.choices as Obj[] | undefined)?.[0]?.message as Obj | undefined)?.content ?? "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      parsed = send.length === 1 ? [content] : null;
    }
    got = Array.isArray(parsed) ? parsed.map(String) : [];
  }
  if (got.length !== send.length || got.some((g, i) => !g.trim() && send[i].trim())) throw new ProviderError("The translation provider's answer didn't match what was sent");
  idx.forEach((i, n) => (out[i] = got[n].slice(0, 10_000)));
  return out;
}
