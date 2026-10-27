import { getFormBySlug } from "@/lib/forms";
import { jsonError } from "@/lib/http";
import { findProjectBySlugOrAlias } from "@/lib/projects";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { SubmissionError, submitForm, type SubmissionFiles } from "@/lib/submissions";

const SUBMISSIONS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_IMAGE_FIELDS = 10;

function fileField(form: FormData, name: string) {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

/**
 * Public endpoint behind the step-by-step form and its embeds. Multipart: a
 * JSON `payload` (answers, rating, person, custom and hidden fields, consent,
 * consent version, request token), plus the files `avatar`, `companyLogo`
 * and `images:<questionKey>` (at most 3 each). `website` is the honeypot.
 * Shares the classic page's limit of 10 submissions per 10 minutes per IP.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string; form: string }> }) {
  const { slug, form: formSlug } = await ctx.params;
  const project = findProjectBySlugOrAlias(slug)?.project;
  const found = project ? getFormBySlug(project.id, formSlug) : null;
  if (!project || !found) return jsonError(404, "Form not found");

  if (!rateLimit(`submit:${clientKey(req)}`, SUBMISSIONS_PER_WINDOW, WINDOW_MS)) {
    return jsonError(429, "Too many submissions, please try again later");
  }

  let data: FormData;
  try {
    data = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data");
  }
  // Honeypot: real people never see or fill this field.
  if (data.get("website")) return Response.json({ ok: true, message: project.thankYouMessage });

  const raw = data.get("payload");
  let input: unknown;
  try {
    input = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    input = null;
  }
  if (!input || typeof input !== "object") return jsonError(400, "Expected a JSON payload");

  const images: Record<string, File[]> = {};
  for (const name of new Set([...data.keys()].filter((k) => k.startsWith("images:")))) {
    if (Object.keys(images).length >= MAX_IMAGE_FIELDS) break;
    images[name.slice("images:".length)] = data
      .getAll(name)
      .filter((v): v is File => v instanceof File && v.size > 0)
      .slice(0, 3);
  }
  const files: SubmissionFiles = { avatar: fileField(data, "avatar"), companyLogo: fileField(data, "companyLogo"), images };

  try {
    const result = await submitForm({ project, form: found.form, input, files, req });
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof SubmissionError) return jsonError(err.status, err.message);
    throw err;
  }
}
