import { z } from "zod";
import { DATE_PRECISIONS } from "@/db/schema";
import { API_STATUSES, type ApiStatus, apiExtras, apiStatus, toApi } from "@/lib/api-shape";
import { apiJson, requireApiKey } from "@/lib/api-keys";
import { projectForKey } from "@/lib/api-v1";
import { audit, keyActor } from "@/lib/audit";
import { CONSENT_SCOPES, grantConsent } from "@/lib/consent";
import { jsonError } from "@/lib/http";
import { createTestimonial, getTestimonial, listTestimonials, updateTestimonial } from "@/lib/testimonials";
import { FETCH_MEDIA_JOB } from "@/lib/csv-import";
import { enqueue } from "@/lib/jobs";
import { authorSocialsSchema, customFieldsSchema, firstIssue, tagNameSchema } from "@/lib/validation";
import { emitTestimonialEvent } from "@/lib/webhooks";
// Registers the notifications listener in this route's bundle.
import "@/lib/notifications";

type Ctx = { params: Promise<{ slug: string }> };

/** A whole-number query parameter: the fallback when absent, null when malformed. */
function intParam(raw: string | null, fallback: number) {
  if (raw === null || raw === "") return fallback;
  return /^-?\d+$/.test(raw) ? Number(raw) : null;
}

/**
 * GET /api/v1/projects/:slug/testimonials?status=&tag=&limit=&offset=
 * Testimonials in the trash are left out unless status=trashed asks for them.
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "read");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return jsonError(404, "Project not found");
  const q = new URL(req.url).searchParams;
  const status = q.get("status") || null;
  if (status && !API_STATUSES.includes(status as ApiStatus)) {
    return jsonError(400, `Unknown status: use ${API_STATUSES.join(", ")}`);
  }
  const limit = intParam(q.get("limit"), 50);
  if (limit === null || limit < 1 || limit > 100) return jsonError(400, "limit must be a whole number from 1 to 100");
  const offset = intParam(q.get("offset"), 0);
  if (offset === null || offset < 0) return jsonError(400, "offset must be a whole number, 0 or more");
  const all = listTestimonials(project.id, { tag: q.get("tag") || undefined }).filter((t) =>
    status === "trashed" ? t.status === "trashed" : t.status !== "trashed" && (!status || apiStatus(t) === status),
  );
  const page = all.slice(offset, offset + limit);
  const extras = apiExtras(page.map((t) => t.id));
  return apiJson({
    data: page.map((t) => toApi(t, extras.get(t.id))),
    pagination: { total: all.length, limit, offset, nextOffset: offset + limit < all.length ? offset + limit : null },
  });
}

const httpUrl = z.url({ protocol: /^https?$/, error: "Use an http:// or https:// address" }).max(2000);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254).optional(),
  title: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  headline: z.string().trim().max(200).optional(),
  text: z.string().trim().min(1).max(5000),
  status: z.enum(["pending", "approved"]).default("pending"),
  tags: z.array(tagNameSchema).max(20).optional(),
  /** The author's (or their company's) site. */
  website: httpUrl.optional(),
  /** Where the review was first posted (google, g2…) and its link and date there. */
  platform: z
    .string()
    .trim()
    .toLowerCase()
    .max(40)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use lowercase letters, numbers, dots and dashes for the platform")
    .optional(),
  sourceUrl: httpUrl.optional(),
  sourceDate: z.union([z.iso.date(), z.iso.datetime({ offset: true })]).optional(),
  datePrecision: z.enum(DATE_PRECISIONS).optional(),
  language: z
    .string()
    .trim()
    .max(35)
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, "Use a language code such as en or pt-BR")
    .optional(),
  customFields: customFieldsSchema.optional(),
  /** EXT-01: the author's profiles ({x, linkedin, instagram, tiktok}), as the browser extension reads them from a post. */
  socials: authorSocialsSchema.optional(),
  /** EXT-01: the author's photo, fetched in the background like an import's (public addresses only). */
  avatarUrl: z.url({ protocol: /^https$/, error: "Use an https:// address for the photo" }).max(2000).optional(),
  /** You confirm the author agreed to publication (recorded in the consent ledger). */
  consent: z.literal(true, { error: "Set consent: true to confirm the author agreed to publication" }),
  consentScopes: z.array(z.enum(CONSENT_SCOPES)).optional(),
});

/** POST /api/v1/projects/:slug/testimonials (write scope): adds a text testimonial. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "write");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { website, sourceDate, socials, avatarUrl, ...input } = parsed.data;
  const t = createTestimonial(
    project.id,
    { ...input, authorWebsite: website, authorSocials: socials, sourceDate: sourceDate ? new Date(sourceDate) : undefined },
    { source: "api" },
  );
  if (avatarUrl) enqueue(FETCH_MEDIA_JOB, { testimonialId: t.id, videoUrl: null, avatarUrl }, { maxAttempts: 3 });
  grantConsent({
    testimonialId: t.id,
    project,
    scopes: (input.consentScopes ?? []).filter((s) => s !== "website"),
    actor: "api",
  });
  if (input.tags) updateTestimonial(t.id, { tags: input.tags }, { actor: "api" });
  emitTestimonialEvent("testimonial.created", getTestimonial(t.id));
  if (input.status === "approved") updateTestimonial(t.id, { status: "approved" }, { actor: "api" });
  audit(keyActor(auth.key), "testimonial.create", { objectType: "testimonial", objectId: t.id, projectId: project.id, summary: input.name, meta: { status: input.status } });
  return apiJson({ data: toApi(getTestimonial(t.id)!) }, 201);
}
