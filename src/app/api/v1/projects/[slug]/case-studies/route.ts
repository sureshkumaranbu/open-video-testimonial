import { z } from "zod";
import { apiJson } from "@/lib/api-keys";
import { apiError, libError, MAX_SMALL_BYTES, projectForKey, readJson, requireApiFeature } from "@/lib/api-v1";
import { audit, keyActor } from "@/lib/audit";
import { caseStudyToAdmin, createCaseStudy, listCaseStudies } from "@/lib/case-studies";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ slug: string }> };

const createBody = z.object({ testimonialId: z.string({ error: "Choose the testimonial" }).trim().min(1, "Choose the testimonial").max(64) });

/** GET /api/v1/projects/:slug/case-studies (L23, SHARE-04; flag insights): the project's case studies, last changed first. */
export async function GET(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "read", "insights");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  return apiJson({ data: listCaseStudies(project.id).map(caseStudyToAdmin) });
}

/** POST /api/v1/projects/:slug/case-studies (write scope): a new draft `{testimonialId}` from the template, as the dashboard makes it (no AI involved). */
export async function POST(req: Request, ctx: Ctx) {
  const auth = requireApiFeature(req, "write", "insights");
  if (auth.error) return auth.error;
  const project = projectForKey(auth.key, (await ctx.params).slug);
  if (!project) return apiError(404, "Project not found");
  const body = await readJson(req, MAX_SMALL_BYTES);
  if (body.error) return body.error;
  const parsed = createBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, firstIssue(parsed.error));
  try {
    const cs = createCaseStudy(project, parsed.data.testimonialId);
    audit(keyActor(auth.key), "case_study.create", { objectType: "case_study", objectId: cs.id, projectId: project.id, summary: `Made the case study “${cs.title}”` });
    return apiJson({ data: caseStudyToAdmin(cs) }, 201);
  } catch (err) {
    return libError(err);
  }
}
