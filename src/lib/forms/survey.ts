import { z } from "zod";
import type { Project } from "@/db/schema";
import { AiError, aiForProject, aiJson, trimForAi } from "../ai";
import { FormError } from "./index";
import { formPagesSchema, type FormPage } from "./schema";

/**
 * NPS-01 surveys: a form whose NPS question and private questions are
 * answered by everyone and kept private, and whose testimonial step (a
 * question, consent, about you) is offered only to promoters who say yes
 * (src/lib/forms/engine.ts visiblePages). A new survey starts paused, so
 * the owner checks its questions before publishing it.
 *
 * "AI survey": with AI on for the project, the owner describes the goal and
 * the provider drafts the NPS wording and up to five questions. Only the
 * goal (capped) is sent, never testimonials. The draft comes back to the
 * dialog, where every question can be changed or removed before the survey
 * is made.
 */

export const MAX_SURVEY_QUESTIONS = 5;

export const surveyInputSchema = z.object({
  npsTitle: z.string().trim().min(1).max(300).optional(),
  questions: z.array(z.string().trim().min(1).max(300)).max(MAX_SURVEY_QUESTIONS).default([]),
});
export type SurveyInput = z.input<typeof surveyInputSchema>;

/** A survey's pages: the NPS question, its private questions, then the testimonial step for promoters who opt in. */
export function surveyPages(projectName: string, input: SurveyInput = {}): FormPage[] {
  const name = projectName.trim() || "us";
  const v = surveyInputSchema.parse(input);
  const questions = v.questions.length ? v.questions : [`What's one thing ${name} could do better?`];
  return formPagesSchema.parse([
    { type: "welcome", enabled: false },
    { type: "nps", key: "nps", title: v.npsTitle || `How likely are you to recommend ${name} to a friend or colleague?` },
    ...questions.map((title, i) => ({ type: "feedback", key: `survey_${i + 1}`, enabled: true, required: false, title })),
    { type: "question", key: "q1", primary: true, required: true, title: `What would you tell someone thinking about ${name}?`, mode: "video_text" },
    { type: "consent" },
    { type: "about_you" },
    { type: "review", enabled: false },
    { type: "thank_you", title: "Thank you!", message: `Your answers help ${name} get better.` },
  ]);
}

const draftSchema = z.object({
  name: z.string().trim().min(1).max(120).catch("Customer survey"),
  npsTitle: z.string().trim().min(1).max(300).nullish().catch(null),
  questions: z.array(z.string().trim().min(1).max(300).nullable().catch(null)).max(10).catch([]),
});

const DRAFT_SYSTEM = [
  "You draft short customer surveys for a business. Answer with only a JSON object, no prose:",
  '{"name": string, "npsTitle": string, "questions": [string]}',
  "name: a short name for the survey. npsTitle: the 0-10 'how likely are you to recommend' question, naming the business. questions: 2 to 5 short, open, neutral questions that serve the goal (no leading questions, no yes/no questions, nothing about personal data).",
].join("\n");

/** NPS-01 "AI survey": a draft name, NPS wording and questions for the dialog. FormError 409 when AI is off for the project. */
export async function draftSurvey(project: Project, goal: string): Promise<{ name: string; npsTitle: string | null; questions: string[] }> {
  if (!aiForProject(project)) throw new FormError(409, "AI isn't on for this project. Write the questions yourself, or see docs/help/insights.md to turn it on.");
  const g = trimForAi(goal, 1000);
  if (g.length < 3) throw new FormError(400, "Describe what you want to learn");
  try {
    const a = await aiJson({ system: DRAFT_SYSTEM, user: `Business: ${trimForAi(project.name, 120)}\nGoal: ${g}`, schema: draftSchema, maxTokens: 600 });
    return { name: a.name, npsTitle: a.npsTitle ?? null, questions: a.questions.filter((q): q is string => Boolean(q)).slice(0, MAX_SURVEY_QUESTIONS) };
  } catch (err) {
    if (err instanceof AiError) throw new FormError(502, err.message);
    throw err;
  }
}
