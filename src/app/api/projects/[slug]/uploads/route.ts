import { directReply, directRequest, openDirect, sessionLimit } from "@/lib/direct-upload";
import { env } from "@/lib/env";
import { getForm } from "@/lib/forms";
import { parseFormRow } from "@/lib/forms/schema";
import { jsonError } from "@/lib/http";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { tooLarge } from "@/lib/sniff";
import { findProjectBySlugOrAlias } from "@/lib/projects";
import { CHUNK_MAX_BYTES, createUpload, MAX_OPEN_UPLOADS_PER_PROJECT, openUploadCount } from "@/lib/uploads";

/** A multi-question form uploads a video per answer, so the start limit is higher than one video per visit needs. */
const STARTS_PER_WINDOW = 60;

/**
 * Starts a resumable video upload for a collection page. A form's answer
 * names its question (?form=<id>&question=<key>, or the same in the JSON
 * body), which must accept a video; without one the project's own setting
 * decides, as on the classic page. `{direct: true, contentType}` asks for a
 * direct-to-S3 session (L9), granted only while S3_DIRECT_UPLOADS is on.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const project = findProjectBySlugOrAlias(slug)?.project;
  if (!project) return jsonError(404, "Project not found");
  const body = (await req.json().catch(() => ({}))) as { size?: unknown; formId?: unknown; questionKey?: unknown };
  const query = new URL(req.url).searchParams;
  const formId = query.get("form") ?? (typeof body.formId === "string" ? body.formId : null);
  const questionKey = query.get("question") ?? (typeof body.questionKey === "string" ? body.questionKey : null);
  if (formId) {
    const form = getForm(formId);
    if (!form || form.projectId !== project.id) return jsonError(404, "Form not found");
    if (form.status === "paused") return jsonError(409, "This form isn't taking testimonials right now");
    const question = parseFormRow(form).pages.find((p) => p.type === "question" && p.key === questionKey);
    if (!question || question.type !== "question" || !question.enabled) return jsonError(400, "This form has no such question");
    if (question.mode === "text") return jsonError(400, "This question takes a written answer, not a video");
  } else if (!project.allowVideo) {
    return jsonError(400, "This page doesn't accept videos");
  }
  if (!rateLimit(`upload-start:${clientKey(req)}`, STARTS_PER_WINDOW, 10 * 60 * 1000)) {
    return jsonError(429, "Too many uploads, please try again later");
  }
  // Bounds the disk an anonymous visitor can tie up with unfinished uploads.
  if (openUploadCount(project.id) >= MAX_OPEN_UPLOADS_PER_PROJECT) {
    return jsonError(429, "Too many uploads in progress right now. Please try again in a while.");
  }
  // A picked file's size is known up front: refuse it before a byte is sent.
  if (typeof body.size === "number" && body.size > env.maxVideoBytes) {
    return jsonError(413, tooLarge(env.maxVideoBytes));
  }
  const direct = directRequest(body);
  const created = createUpload("video", { projectId: project.id, maxBytes: sessionLimit(direct, body.size, env.maxVideoBytes), direct });
  const upload = await openDirect(created.upload);
  return Response.json(
    { id: upload.id, token: created.token, offset: 0, chunkSize: CHUNK_MAX_BYTES, expiresAt: upload.expiresAt.toISOString(), ...directReply(upload) },
    { status: 201 },
  );
}
