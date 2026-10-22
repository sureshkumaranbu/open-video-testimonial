import { z } from "zod";
import { TESTIMONIAL_STATUSES } from "@/db/schema";
import { toApi } from "@/lib/api-shape";
import { apiJson, requireApiKey } from "@/lib/api-keys";
import { grantConsent } from "@/lib/consent";
import { jsonError } from "@/lib/http";
import { createTestimonial, getProjectBySlug, getTestimonial, listTestimonials, updateTestimonial } from "@/lib/testimonials";
import { firstIssue, tagNameSchema } from "@/lib/validation";
import { emitTestimonialEvent } from "@/lib/webhooks";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/v1/projects/:slug/testimonials?status=&tag=&limit=&offset= */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "read");
  if (auth.error) return auth.error;
  const project = getProjectBySlug((await ctx.params).slug);
  if (!project) return jsonError(404, "Project not found");
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  if (status && !TESTIMONIAL_STATUSES.includes(status as never)) return jsonError(400, "Unknown status");
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(q.get("offset") ?? 0) || 0, 0);
  const all = listTestimonials(project.id, {
    status: (status as (typeof TESTIMONIAL_STATUSES)[number]) || undefined,
    tag: q.get("tag") || undefined,
  });
  const page = all.slice(offset, offset + limit);
  return apiJson({
    data: page.map(toApi),
    pagination: { total: all.length, limit, offset, nextOffset: offset + limit < all.length ? offset + limit : null },
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254).optional(),
  title: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  text: z.string().trim().min(1).max(5000),
  status: z.enum(["pending", "approved"]).default("pending"),
  tags: z.array(tagNameSchema).max(20).optional(),
  /** You confirm the author agreed to publication (recorded in the consent ledger). */
  consent: z.literal(true, { error: "Set consent: true to confirm the author agreed to publication" }),
  consentScopes: z.array(z.enum(["website", "social"])).optional(),
});

/** POST /api/v1/projects/:slug/testimonials (write scope): adds a text testimonial. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = requireApiKey(req, "write");
  if (auth.error) return auth.error;
  const project = getProjectBySlug((await ctx.params).slug);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const input = parsed.data;
  const t = createTestimonial(project.id, input, { source: "api" });
  grantConsent({
    testimonialId: t.id,
    project,
    scopes: (input.consentScopes ?? []).filter((s) => s !== "website"),
    actor: "api",
  });
  if (input.tags) updateTestimonial(t.id, { tags: input.tags }, { actor: "api" });
  emitTestimonialEvent("testimonial.created", getTestimonial(t.id));
  if (input.status === "approved") updateTestimonial(t.id, { status: "approved" }, { actor: "api" });
  return apiJson({ data: toApi(getTestimonial(t.id)!) }, 201);
}
