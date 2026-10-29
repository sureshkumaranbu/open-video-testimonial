import type { z } from "zod";
import type { Project } from "@/db/schema";
import { env } from "./env";
import { ProviderError, providerJson } from "./provider-fetch";

/**
 * The shared, optional AI client: any OpenAI-compatible /chat/completions
 * endpoint (AI_API_URL, AI_API_KEY, AI_MODEL). Off unless the model is set;
 * the key is optional, since a model on the owner's own machine (Ollama,
 * llama.cpp, vLLM) usually needs none. The M17 features (case studies,
 * Voice of Customer, AI surveys, screenshot OCR) and the onboarding brand
 * scan's fallback use it, so it knows nothing about any of them.
 *
 * Called from the server only, never while a public page is being served,
 * and only when the owner asks for an AI step (a "Draft with AI" button and
 * so on). Like translation and embeddings it goes through provider-fetch:
 * the address comes from the server's settings, never from a request,
 * redirects are refused, and the wait and the answer's size are capped. What
 * is sent is capped too, so callers trim their input. Every answer is a JSON
 * object checked against the caller's zod schema; anything else is an
 * AiError, and the caller keeps its non-AI result.
 */

export class AiError extends ProviderError {}

/** Characters of system and user text one call may send, unless the caller sets less. */
const MAX_INPUT_CHARS = 16_000;
/** Bytes of images (as base64 data: URIs) one call may send. */
export const MAX_IMAGE_CHARS = 6 * 1024 * 1024;
/** The answer's size cap, and the default and longest waits. */
const MAX_ANSWER_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;

export type AiRequest = { model: string; system: string; user: string; maxTokens: number; images: string[] };
/** A test stand-in: the assistant message's content (a string), or a value that is sent through JSON.stringify. */
export type AiStub = (req: AiRequest) => unknown;

let stub: AiStub | null = null;
/** Tests only: answer every call with this instead of the provider. AI counts as on while it's set. */
export function setAiStub(fn: AiStub | null) {
  stub = fn;
}

/** Whether this server has an AI provider (AI_MODEL set). */
export function aiEnabled() {
  if (stub) return true;
  return Boolean(env.aiModel && env.aiApiUrl);
}

/**
 * Whether AI may be used for this project: the server has a provider and the
 * project hasn't been switched off (Insights → "AI in this project"), so an
 * owner can keep one project's testimonials away from the provider entirely.
 */
export function aiForProject(project: Pick<Project, "aiEnabled"> | null | undefined) {
  return aiEnabled() && Boolean(project?.aiEnabled);
}

/** For Settings → This server: whether AI is on, and which model at which host. */
export function aiStatus(): { enabled: boolean; model: string | null; host: string | null } {
  if (stub) return { enabled: true, model: "test stub", host: null };
  if (!aiEnabled()) return { enabled: false, model: null, host: null };
  let host: string | null = null;
  try {
    host = new URL(env.aiApiUrl).host;
  } catch {
    // A malformed AI_API_URL: the call itself will say so.
  }
  return { enabled: true, model: env.aiModel, host };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiError(`No answer from the AI provider within ${Math.round(ms / 1000)} s`)), ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Text for the provider: control characters out, runs of blank space folded, cut to `max` characters. */
export function trimForAi(text: string | null | undefined, max: number): string {
  return (text ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, Math.max(0, max));
}

/**
 * Asks the model for one JSON object and returns it checked by `schema`.
 * `images` are data: URIs sent with the user text as a vision message
 * (OCR). `timeoutMs` covers the whole call (default 20 s, at most 60 s).
 * Throws AiError when AI is off, the input is over the cap, the provider
 * fails, or the answer isn't JSON matching the schema.
 */
export async function aiJson<T>(o: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  images?: string[];
  timeoutMs?: number;
  maxTokens?: number;
  maxInputChars?: number;
}): Promise<T> {
  if (!aiEnabled()) throw new AiError("AI isn't set up on this server (AI_MODEL)");
  const limit = Math.min(o.maxInputChars ?? MAX_INPUT_CHARS, MAX_INPUT_CHARS);
  if (o.system.length + o.user.length > limit) throw new AiError(`The text for the AI provider is over ${limit} characters`);
  const images = o.images ?? [];
  if (images.some((i) => !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(i))) throw new AiError("Images go to the AI provider as PNG, JPEG or WebP data only");
  if (images.reduce((n, i) => n + i.length, 0) > MAX_IMAGE_CHARS) throw new AiError("The image is too large to send to the AI provider");
  const timeoutMs = Math.min(Math.max(o.timeoutMs ?? DEFAULT_TIMEOUT_MS, 500), MAX_TIMEOUT_MS);
  const req: AiRequest = { model: env.aiModel, system: o.system, user: o.user, maxTokens: Math.min(Math.max(o.maxTokens ?? 500, 1), 4000), images };

  let content: string;
  try {
    if (stub) {
      const v = await withTimeout(Promise.resolve().then(() => stub!(req)), timeoutMs);
      content = typeof v === "string" ? v : JSON.stringify(v);
    } else {
      const user = images.length
        ? [{ type: "text", text: req.user }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
        : req.user;
      const json = (await providerJson(
        `${env.aiApiUrl}/chat/completions`,
        {
          model: req.model,
          temperature: 0,
          max_tokens: req.maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: user },
          ],
        },
        { headers: env.aiApiKey ? { Authorization: `Bearer ${env.aiApiKey}` } : {}, timeoutMs, maxBytes: MAX_ANSWER_BYTES },
      )) as { choices?: { message?: { content?: unknown } }[] };
      content = String(json?.choices?.[0]?.message?.content ?? "");
    }
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError(`The AI provider failed: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AiError("The AI provider's answer wasn't JSON");
  }
  const checked = o.schema.safeParse(parsed);
  if (!checked.success) throw new AiError("The AI provider's answer didn't have the expected shape");
  return checked.data;
}

/** Lower case letters and digits only, so a quote matches whatever punctuation and spacing the source used. */
export const plainWords = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whether `quote` appears word for word in `source` (punctuation and case aside): how AI suggestions are kept honest. */
export function quotedFrom(quote: string, source: string) {
  const q = plainWords(quote);
  return q.length > 0 && plainWords(source).includes(q);
}
