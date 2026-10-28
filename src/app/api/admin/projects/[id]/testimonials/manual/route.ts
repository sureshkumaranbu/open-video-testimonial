import { auditRequest } from "@/lib/audit";
import { getRequestSession } from "@/lib/auth";
import { caseStudyToAdmin, createCaseStudy } from "@/lib/case-studies";
import { jsonError, requireRole } from "@/lib/http";
import { addManualTestimonial, ManualAddError } from "@/lib/manual-add";
import { UnsupportedMediaError, UploadError } from "@/lib/storage";
import { getProjectById } from "@/lib/testimonials";

type Ctx = { params: Promise<{ id: string }> };

const fileOf = (v: FormDataEntryValue | null) => (v instanceof File && v.size > 0 ? v : null);

/**
 * Adds a testimonial by hand (PRD §8.1). Multipart: `payload` is the JSON
 * (lib/manual-add.ts manualInputSchema, plus `videoUpload: {id, token}` for a
 * finished resumable upload), with files `avatar`, `companyLogo` and up to 5
 * `images`. Answers 201 `{testimonial}`. The Case study tab (`kind:
 * "case_study"`, SHARE-04) also makes a case study from it: `{testimonial, caseStudy}`.
 */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "Send the testimonial as a form");
  let payload: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(String(form.get("payload") ?? ""));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    payload = v as Record<string, unknown>;
  } catch {
    return jsonError(400, "Send the testimonial's details as JSON in the payload field");
  }
  const { videoUpload, ...input } = payload;
  const upload =
    videoUpload && typeof videoUpload === "object"
      ? { id: String((videoUpload as { id?: unknown }).id ?? ""), token: String((videoUpload as { token?: unknown }).token ?? "") }
      : null;
  try {
    const testimonial = await addManualTestimonial(
      project,
      input as Parameters<typeof addManualTestimonial>[1],
      {
        avatar: fileOf(form.get("avatar")),
        companyLogo: fileOf(form.get("companyLogo")),
        images: form.getAll("images").map(fileOf).filter((f): f is File => f !== null),
        videoUpload: upload,
      },
      getRequestSession(req)?.email,
    );
    auditRequest(req, "testimonial.create", { objectType: "testimonial", objectId: testimonial.id, projectId: testimonial.projectId, summary: testimonial.authorName, meta: { source: "manual" } });
    if (input.kind === "case_study") {
      const cs = createCaseStudy(project, testimonial.id);
      auditRequest(req, "case_study.create", { objectType: "case_study", objectId: cs.id, projectId: project.id, summary: `Made the case study “${cs.title}”` });
      return Response.json({ testimonial, caseStudy: caseStudyToAdmin(cs) }, { status: 201 });
    }
    return Response.json({ testimonial }, { status: 201 });
  } catch (err) {
    if (err instanceof ManualAddError) return jsonError(err.status, err.message);
    if (err instanceof UnsupportedMediaError) return jsonError(415, err.message);
    if (err instanceof UploadError) return jsonError(400, err.message);
    throw err;
  }
}
