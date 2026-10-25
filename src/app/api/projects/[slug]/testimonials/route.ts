import { clientKey, rateLimit } from "@/lib/rate-limit";
import { getDefaultForm } from "@/lib/forms";
import { findProjectBySlugOrAlias } from "@/lib/projects";
import { legacySubmission, SubmissionError, submitForm } from "@/lib/submissions";
import { getUpload } from "@/lib/uploads";
import { firstIssue, submissionSchema } from "@/lib/validation";
import { jsonError } from "@/lib/http";

const SUBMISSIONS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;

function fileField(form: FormData, name: string) {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

/**
 * Public endpoint behind the classic collection page (and the e2e seed). New
 * testimonials start as pending, unless the form auto-approves them. A thin
 * adapter onto submitForm with the default form: same fields (including the
 * old direct `video`), honeypot, limit and response, plus `thankYou`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const project = findProjectBySlugOrAlias(slug)?.project;
  if (!project) return jsonError(404, "Project not found");

  if (!rateLimit(`submit:${clientKey(req)}`, SUBMISSIONS_PER_WINDOW, WINDOW_MS)) {
    return jsonError(429, "Too many submissions, please try again later");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data");
  }

  // Honeypot: real people never see or fill this field.
  if (form.get("website")) return Response.json({ ok: true, message: project.thankYouMessage });

  const parsed = submissionSchema.safeParse(Object.fromEntries(
    ["name", "email", "title", "company", "rating", "text", "consent", "consentSocial", "consentVersion", "requestToken"].map((k) => [
      k,
      typeof form.get(k) === "string" ? form.get(k) : undefined,
    ]),
  ));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const input = parsed.data;

  const video = project.allowVideo ? fileField(form, "video") : null;
  // A video sent earlier through the resumable upload API.
  const uploadId = project.allowVideo ? form.get("videoUpload") : null;
  const videoUpload = typeof uploadId === "string" && uploadId ? uploadId : undefined;
  if (videoUpload) {
    const token = form.get("videoUploadToken");
    const upload = getUpload(videoUpload, typeof token === "string" ? token : null);
    if (!upload || upload.kind !== "video" || upload.projectId !== project.id) {
      return jsonError(400, "The video upload has expired. Please upload it again.");
    }
  }
  const avatar = fileField(form, "avatar");
  const text = project.allowText ? input.text : undefined;
  if (!text && !video && !videoUpload) {
    return jsonError(
      400,
      project.allowVideo && project.allowText
        ? "Please write a testimonial or record a video"
        : project.allowVideo
          ? "Please record or upload a video"
          : "Please write a testimonial",
    );
  }

  // The default form's rules (pause, limits, tags, auto-approve, receipt) apply here too.
  const defaultForm = getDefaultForm(project.id);
  try {
    const token = form.get("videoUploadToken");
    const result = await submitForm({
      project,
      form: defaultForm,
      input: legacySubmission(defaultForm, {
        ...input,
        text,
        videoUpload,
        videoUploadToken: typeof token === "string" ? token : undefined,
        consentSocial: input.consentSocial,
      }),
      files: { video, avatar },
      req,
      legacy: true,
    });
    return Response.json(
      { ok: true, id: result.id, message: result.message, withdrawUrl: result.withdrawUrl, thankYou: result.thankYou },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof SubmissionError) return jsonError(err.status, err.message);
    throw err;
  }
}
