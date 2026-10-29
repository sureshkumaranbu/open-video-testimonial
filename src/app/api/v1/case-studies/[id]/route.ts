import { z } from "zod";
import { CASE_STUDY_STATUSES } from "@/db/schema";
import { apiJson } from "@/lib/api-keys";
import { apiError, libError, MAX_SMALL_BYTES, projectOfRow, readJson, requireApiFeature } from "@/lib/api-v1";
import { audit, keyActor } from "@/lib/audit";
import { caseStudyToAdmin, getCaseStudy, parseContent, updateCaseStudy } from "@/lib/case-studies";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** What may change; `content` fields left out keep their values. The editor's own checks (updateCaseStudy) then apply. */
const patchBody = z.strictObject({
  title: z.string().max(200).optional(),
  status: z.enum(CASE_STUDY_STATUSES).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

/** GET /api/v1/case-studies/:id (L23, SHARE-04; flag insights) */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "read", "insights");
  if (auth.error) return auth.error;
  const cs = getCaseStudy((await ctx.params).id);
  if (!cs || !projectOfRow(auth.key, cs)) return apiError(404, "Case study not found");
  return apiJson({ data: caseStudyToAdmin(cs) });
}

/**
 * PATCH /api/v1/case-studies/:id (write scope): the title, `status`
 * (published makes /cs/<id> and its PDF public while the testimonial is) and
 * any of the content's fields (summary, challenge, solution, result,
 * pullQuote, metrics).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "write", "insights");
  if (auth.error) return auth.error;
  const before = getCaseStudy((await ctx.params).id);
  const project = projectOfRow(auth.key, before);
  if (!before || !project) return apiError(404, "Case study not found");
  const body = await readJson(req, MAX_SMALL_BYTES);
  if (body.error) return body.error;
  const parsed = patchBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  const p = parsed.data;
  try {
    const cs = updateCaseStudy(before.id, { title: p.title ?? before.title, status: p.status, content: { ...parseContent(before.content), ...p.content } })!;
    const action = cs.status !== before.status ? (cs.status === "published" ? "case_study.publish" : "case_study.unpublish") : "case_study.update";
    audit(keyActor(auth.key), action, { objectType: "case_study", objectId: cs.id, projectId: project.id, summary: `${action === "case_study.update" ? "Changed" : action === "case_study.publish" ? "Published" : "Unpublished"} the case study “${cs.title}”` });
    return apiJson({ data: caseStudyToAdmin(cs) });
  } catch (err) {
    return libError(err);
  }
}
