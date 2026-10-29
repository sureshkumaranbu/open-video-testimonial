import { z } from "zod";
import type { Project, Testimonial } from "@/db/schema";
import { AiError, aiForProject, aiJson, plainWords, quotedFrom, trimForAi } from "../ai";
import { MAX_DRAFT_CHARS, roleOf, wordsOf } from "./social";

/**
 * INT-08 "Rewrite with AI": a suggestion for the drawer's social post (not
 * saved; the editor keeps it or not). Only when AI is on for the project, on
 * an editor's press. The M17 rule holds: the quote must be the customer's
 * own words (quotedFrom), and it must be in the post; anything else is refused.
 */

export class SocialAiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const answer = z.object({ text: z.string().trim().min(1).max(1000), quote: z.string().trim().min(1).max(600) });

const SYSTEM = [
  "You write one short social media post, for X and LinkedIn, that shares a customer's testimonial. Answer with only a JSON object, no prose:",
  '{"text": string, "quote": string}',
  "quote is one or two sentences copied word for word from the customer's words. text is the whole post: it contains the quote in quotation marks and the customer's name,",
  `is at most ${MAX_DRAFT_CHARS - 16} characters, has no link (one is added after it), no hashtags or emoji the customer didn't use, and says nothing the customer didn't say.`,
].join("\n");

const unquote = (s: string) => s.replace(/^["“”'‘]+|["“”'’]+$/g, "").trim();

export async function rewriteSocialDraft(
  project: Pick<Project, "name" | "aiEnabled">,
  t: Pick<Testimonial, "text" | "transcript" | "headline" | "authorName" | "authorTitle" | "authorCompany">,
  current: string,
): Promise<{ text: string; quote: string }> {
  if (!aiForProject(project)) throw new SocialAiError(409, "AI isn't on for this project, so the draft stays the template. See docs/help/insights.md to turn it on.");
  const words = wordsOf(t);
  if (!words) throw new SocialAiError(409, "This testimonial has no words to quote yet (a video waits for its transcript)");
  const who = [t.authorName, roleOf(t)].filter(Boolean).map((s) => trimForAi(s, 120)).join(", ");
  const user = [`Business: ${trimForAi(project.name, 120)}`, `Customer: ${who}`, "", `The customer's words: ${trimForAi(words, 4000)}`, "", `The current draft: ${trimForAi(current, 400)}`].join("\n");
  let a: z.infer<typeof answer>;
  try {
    a = await aiJson({ system: SYSTEM, user, schema: answer, maxTokens: 400, timeoutMs: 30_000 });
  } catch (err) {
    if (err instanceof AiError) throw new SocialAiError(502, err.message);
    throw err;
  }
  const quote = unquote(a.quote);
  if (!quotedFrom(quote, words)) throw new SocialAiError(422, "The AI's quote wasn't the customer's own words, so your draft was kept.");
  if (!plainWords(a.text).includes(plainWords(quote))) throw new SocialAiError(422, "The AI's post didn't use the customer's quote, so your draft was kept.");
  if (a.text.length > MAX_DRAFT_CHARS) throw new SocialAiError(422, "The AI's post was too long for X, so your draft was kept.");
  return { text: a.text, quote };
}
