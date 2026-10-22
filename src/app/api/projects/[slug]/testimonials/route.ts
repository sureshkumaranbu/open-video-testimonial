import { clientIp, rateLimit } from "@/lib/rate-limit";
import { deleteObject, saveUpload, UploadError } from "@/lib/storage";
import { createTestimonial, getProjectBySlug } from "@/lib/testimonials";
import { firstIssue, submissionSchema } from "@/lib/validation";
import { jsonError } from "@/lib/http";

const SUBMISSIONS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;

function fileField(form: FormData, name: string) {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

/** Public endpoint behind the collection page. New testimonials start as pending. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const project = getProjectBySlug(slug);
  if (!project) return jsonError(404, "Project not found");

  if (!rateLimit(`submit:${clientIp(req)}`, SUBMISSIONS_PER_WINDOW, WINDOW_MS)) {
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
    ["name", "email", "title", "company", "rating", "text", "consent"].map((k) => [
      k,
      typeof form.get(k) === "string" ? form.get(k) : undefined,
    ]),
  ));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const input = parsed.data;

  const video = project.allowVideo ? fileField(form, "video") : null;
  const avatar = fileField(form, "avatar");
  const text = project.allowText ? input.text : undefined;
  if (!text && !video) {
    return jsonError(
      400,
      project.allowVideo && project.allowText
        ? "Please write a testimonial or record a video"
        : project.allowVideo
          ? "Please record or upload a video"
          : "Please write a testimonial",
    );
  }

  const saved: string[] = [];
  try {
    const storedVideo = video ? await saveUpload(video, "video") : null;
    if (storedVideo) saved.push(storedVideo.key);
    const storedAvatar = avatar ? await saveUpload(avatar, "image") : null;
    if (storedAvatar) saved.push(storedAvatar.key);

    const testimonial = createTestimonial(project.id, {
      ...input,
      text,
      videoKey: storedVideo?.key,
      videoMime: storedVideo?.mime,
      avatarKey: storedAvatar?.key,
    });
    return Response.json(
      { ok: true, id: testimonial.id, message: project.thankYouMessage },
      { status: 201 },
    );
  } catch (err) {
    await Promise.all(saved.map((key) => deleteObject(key)));
    if (err instanceof UploadError) return jsonError(400, err.message);
    throw err;
  }
}
