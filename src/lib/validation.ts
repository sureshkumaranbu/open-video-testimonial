import { z } from "zod";
import { TESTIMONIAL_STATUSES } from "@/db/schema";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Fields of the public collection form (files are validated separately). */
export const submissionSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.email("Please enter a valid email").optional()),
  title: optionalText(120),
  company: optionalText(120),
  rating: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(5)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  text: optionalText(5000),
  consent: z.literal("on", { error: "Please tick the consent box so we can share your testimonial" }),
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes");

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema,
  prompt: z.string().trim().min(1).max(300).optional(),
  thankYouMessage: z.string().trim().min(1).max(300).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  allowVideo: z.boolean().optional(),
  allowText: z.boolean().optional(),
  /** One prompt per line, at most 8 lines. */
  questions: z
    .string()
    .max(1200)
    .transform((v) =>
      v
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 8)
        .join("\n"),
    )
    .optional(),
  maxVideoSeconds: z.number().int().min(15).max(600).optional(),
});

export const projectUpdateSchema = projectSchema.partial().omit({ slug: true });

export const tagNameSchema = z.string().trim().min(1).max(32);

export const testimonialUpdateSchema = z.object({
  status: z.enum(TESTIMONIAL_STATUSES).optional(),
  authorName: z.string().trim().min(1).max(120).optional(),
  authorTitle: z.string().trim().max(120).nullable().optional(),
  authorCompany: z.string().trim().max(120).nullable().optional(),
  text: z.string().trim().max(5000).nullable().optional(),
  transcript: z.string().trim().max(50_000).nullable().optional(),
  /** WebVTT or SRT; normalised to WebVTT before saving. */
  captionsVtt: z.string().max(200_000).nullable().optional(),
  tags: z.array(tagNameSchema).max(20).optional(),
});

export function firstIssue(error: z.ZodError) {
  const issue = error.issues[0];
  return issue ? issue.message : "Invalid input";
}
