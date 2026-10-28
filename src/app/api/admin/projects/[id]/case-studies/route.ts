import { aiForProject } from "@/lib/ai";
import { auditRequest } from "@/lib/audit";
import { CaseStudyError, caseStudyCandidates, caseStudyToAdmin, createCaseStudy, listCaseStudies } from "@/lib/case-studies";
import { jsonError, readJsonCapped, requireRole } from "@/lib/http";
import { getProjectById } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string }> };

/** SHARE-04: the project's case studies, the testimonials one can be made from, and whether "Draft with AI" is on. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json(
    { caseStudies: listCaseStudies(project.id).map(caseStudyToAdmin), candidates: caseStudyCandidates(project.id), ai: aiForProject(project) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** SHARE-04: a new draft `{testimonialId}`, filled from the template (no AI involved). */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const input = await readJsonCapped(req);
  if (input instanceof Response) return input;
  const testimonialId = typeof (input as { testimonialId?: unknown })?.testimonialId === "string" ? (input as { testimonialId: string }).testimonialId : "";
  if (!testimonialId) return jsonError(400, "Choose the testimonial");
  try {
    const cs = createCaseStudy(project, testimonialId);
    auditRequest(req, "case_study.create", { objectType: "case_study", objectId: cs.id, projectId: project.id, summary: `Made the case study “${cs.title}”` });
    return Response.json({ caseStudy: caseStudyToAdmin(cs) }, { status: 201 });
  } catch (err) {
    if (err instanceof CaseStudyError) return jsonError(err.status, err.message);
    throw err;
  }
}
