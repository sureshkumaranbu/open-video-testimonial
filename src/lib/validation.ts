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
  consentSocial: z.literal("on").optional(),
  consentVersion: z.string().max(64).optional(),
  requestToken: z.string().max(100).optional(),
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
  /** Empty restores the default wording. */
  consentText: z.string().trim().max(1000).optional(),
  inviteSubject: z.string().trim().max(200).optional(),
  inviteMessage: z.string().trim().max(5000).optional(),
  /** Comma-separated days after the invitation, e.g. "3,7". */
  reminderDays: z
    .string()
    .max(40)
    .regex(/^[\d,\s]*$/, "Use whole days separated by commas, e.g. 3, 7")
    .optional(),
  thankYouEmail: z.boolean().optional(),
});

export const projectUpdateSchema = projectSchema
  .extend({
    autoApprove: z.boolean(),
    autoApproveMinRating: z.union([z.literal(4), z.literal(5)]),
    autoApproveVideo: z.boolean(),
  })
  .partial()
  .omit({ slug: true });

export const tagNameSchema = z.string().trim().min(1).max(32);

export const testimonialUpdateSchema = z.object({
  status: z.enum(TESTIMONIAL_STATUSES).optional(),
  authorName: z.string().trim().min(1).max(120).optional(),
  authorTitle: z.string().trim().max(120).nullable().optional(),
  authorCompany: z.string().trim().max(120).nullable().optional(),
  text: z.string().trim().max(5000).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  transcript: z.string().trim().max(50_000).nullable().optional(),
  /** WebVTT or SRT; normalised to WebVTT before saving. */
  captionsVtt: z.string().max(200_000).nullable().optional(),
  tags: z.array(tagNameSchema).max(20).optional(),
});

// ------------------------------------------------------------- messages

/** How fields are named in error messages. Unlisted ones are de-camel-cased. */
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  authorName: "Name",
  email: "Email",
  title: "Title",
  authorTitle: "Title",
  company: "Company",
  authorCompany: "Company",
  text: "Testimonial text",
  slug: "Link slug",
  prompt: "Prompt",
  thankYouMessage: "Thank-you message",
  questions: "Questions",
  consentText: "Consent wording",
  inviteSubject: "Invitation subject",
  inviteMessage: "Invitation message",
  reminderDays: "Reminder days",
  captionsVtt: "Captions",
  url: "Webhook URL",
  events: "Events",
  tags: "Tags",
  consentScopes: "Consent scopes",
  projectId: "Project",
};

/** Fields whose rule is easier to state whole than to derive from the failed check. */
const FIELD_RULES: Record<string, string> = {
  rating: "Rating must be a whole number from 1 to 5",
  accentColor: "Accent colour must be a hex colour such as #e2463f",
  maxVideoSeconds: "Maximum video length must be a whole number of seconds from 15 to 600",
  scope: "Access must be read or write",
  status: "Status must be pending, approved or rejected",
};

function fieldOf(path: readonly PropertyKey[] | undefined) {
  return [...(path ?? [])].reverse().find((p): p is string => typeof p === "string");
}

function labelOf(field: string | undefined) {
  if (!field) return "This value";
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const plural = (n: unknown, one: string, many: string) => `${n} ${Number(n) === 1 ? one : many}`;

type RawIssue = {
  code?: string;
  path?: PropertyKey[];
  input?: unknown;
  origin?: string;
  minimum?: unknown;
  maximum?: unknown;
  values?: unknown[];
  format?: string;
  expected?: string;
  keys?: string[];
};

/**
 * Plain-English text for a failed check, naming the field, in place of
 * Zod's developer-facing defaults ("Too small: expected string to have
 * >=1 characters"). Messages written into a schema still win.
 */
export function friendlyIssue(iss: RawIssue): string {
  const field = fieldOf(iss.path);
  if (field && FIELD_RULES[field]) return FIELD_RULES[field];
  const what = labelOf(field);
  switch (iss.code) {
    case "too_small":
      if (iss.origin === "string") {
        return Number(iss.minimum) <= 1 ? `${what} can't be empty` : `${what} must be at least ${plural(iss.minimum, "character", "characters")}`;
      }
      if (iss.origin === "array" || iss.origin === "set") return `${what} needs at least ${plural(iss.minimum, "item", "items")}`;
      return `${what} must be at least ${iss.minimum}`;
    case "too_big":
      if (iss.origin === "string") return `${what} can be at most ${plural(iss.maximum, "character", "characters")}`;
      if (iss.origin === "array" || iss.origin === "set") return `${what} can have at most ${plural(iss.maximum, "item", "items")}`;
      return `${what} must be at most ${iss.maximum}`;
    case "invalid_type":
      if (!field && (iss.input === null || typeof iss.input !== "object")) return "The request body must be a JSON object";
      if (iss.input === undefined) return `${what} is required`;
      if (iss.expected === "number" || iss.expected === "int") return `${what} must be a number`;
      if (iss.expected === "boolean") return `${what} must be true or false`;
      if (iss.expected === "array") return `${what} must be a list`;
      if (iss.expected === "string") return `${what} must be text`;
      return `${what} isn't valid`;
    case "invalid_value":
      return iss.values?.length
        ? `${what} must be ${iss.values.length === 1 ? "" : "one of: "}${iss.values.map(String).join(", ")}`
        : `${what} isn't valid`;
    case "invalid_format":
      if (iss.format === "email") return `${what} must be a valid email address`;
      if (iss.format === "url") return `${what} must be a valid http(s) address`;
      return `${what} isn't in the right format`;
    case "unrecognized_keys":
      return `Unknown ${iss.keys && iss.keys.length > 1 ? "fields" : "field"}: ${(iss.keys ?? []).join(", ")}`;
    default:
      return `${what} isn't valid`;
  }
}

// Applies to every schema in the app; messages a schema sets itself win.
z.config({ customError: (iss) => friendlyIssue(iss as RawIssue) });

export function firstIssue(error: z.ZodError) {
  const issue = error.issues[0];
  return issue ? issue.message : "Something in the request isn't valid";
}
