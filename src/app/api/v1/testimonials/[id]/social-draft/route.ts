import { apiJson } from "@/lib/api-keys";
import { apiError, MAX_SMALL_BYTES, projectOfRow, readJson, requireApiFeature, socialDraftToApi } from "@/lib/api-v1";
import { audit, keyActor } from "@/lib/audit";
import { ensureSocialDraft, saveSocialDraft, socialDraftBody } from "@/lib/commerce/social";
import type { ApiKey } from "@/db/schema";
import { getTestimonial } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";
import { emitSocialDraftUpdated } from "@/lib/webhooks";

type Ctx = { params: Promise<{ id: string }> };

/** The approved testimonial the key may reach, or the error to send (a draft exists only once it's approved). */
async function approved(key: ApiKey, ctx: Ctx) {
  const t = getTestimonial((await ctx.params).id);
  if (!t || !projectOfRow(key, t)) return apiError(404, "Testimonial not found");
  if (t.status !== "approved" || t.withdrawnAt) return apiError(409, "A social post draft is made once the testimonial is approved");
  return t;
}

/** GET /api/v1/testimonials/:id/social-draft (L25, INT-08; flag commerce): the draft (made from the template if it has none yet), its link and share links. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "read", "commerce");
  if (auth.error) return auth.error;
  const t = await approved(auth.key, ctx);
  if (t instanceof Response) return t;
  return apiJson({ data: socialDraftToApi(t, ensureSocialDraft(t)!) });
}

/** PATCH /api/v1/testimonials/:id/social-draft (write scope): `{text}`, at most 256 characters so it fits on X with the link. Sends testimonial.social_draft_updated. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "write", "commerce");
  if (auth.error) return auth.error;
  const t = await approved(auth.key, ctx);
  if (t instanceof Response) return t;
  const body = await readJson(req, MAX_SMALL_BYTES);
  if (body.error) return body.error;
  const parsed = socialDraftBody.pick({ text: true }).strict().safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const actor = keyActor(auth.key);
  const draft = saveSocialDraft(t, parsed.data, actor.label);
  audit(actor, "social_draft.update", { objectType: "testimonial", objectId: t.id, projectId: t.projectId, summary: `Changed ${t.authorName}’s social post draft` });
  emitSocialDraftUpdated(t, draft);
  return apiJson({ data: socialDraftToApi(t, draft) });
}
