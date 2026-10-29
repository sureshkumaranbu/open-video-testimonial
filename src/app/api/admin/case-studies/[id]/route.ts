import { auditRequest } from "@/lib/audit";
import { CaseStudyError, caseStudyToAdmin, deleteCaseStudy, getCaseStudy, updateCaseStudy } from "@/lib/case-studies";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const cs = getCaseStudy((await ctx.params).id);
  if (!cs) return jsonError(404, "Case study not found");
  return Response.json({ caseStudy: caseStudyToAdmin(cs) }, { headers: { "Cache-Control": "private, no-store" } });
}

/** SHARE-04: saves `{title, status?, content, aiDrafted?}`; publishing makes /cs/<id> and its PDF public while the testimonial is. */
export async function PUT(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const before = getCaseStudy((await ctx.params).id);
  if (!before) return jsonError(404, "Case study not found");
  const input = await readJsonCapped(req);
  if (input instanceof Response) return input;
  try {
    const cs = updateCaseStudy(before.id, input)!;
    const action = cs.status !== before.status ? (cs.status === "published" ? "case_study.publish" : "case_study.unpublish") : "case_study.update";
    auditRequest(req, action, { objectType: "case_study", objectId: cs.id, projectId: cs.projectId, summary: `${action === "case_study.update" ? "Changed" : action === "case_study.publish" ? "Published" : "Unpublished"} the case study “${cs.title}”` });
    return Response.json({ caseStudy: caseStudyToAdmin(cs) });
  } catch (err) {
    if (err instanceof CaseStudyError) return jsonError(err.status, err.message);
    throw err;
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const cs = getCaseStudy((await ctx.params).id);
  if (!cs) return jsonError(404, "Case study not found");
  deleteCaseStudy(cs.id);
  auditRequest(req, "case_study.delete", { objectType: "case_study", objectId: cs.id, projectId: cs.projectId, summary: `Deleted the case study “${cs.title}”` });
  return new Response(null, { status: 204 });
}
