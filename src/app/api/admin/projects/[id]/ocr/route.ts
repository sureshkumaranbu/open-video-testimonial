import { auditRequest } from "@/lib/audit";
import { jsonError, readCappedBytes, requireRole } from "@/lib/http";
import { MAX_OCR_BYTES, OcrError, readScreenshot } from "@/lib/ocr";
import { getProjectById } from "@/lib/testimonials";

/**
 * IMP-07: reads a screenshot (multipart `image`, PNG, JPEG or WebP up to
 * 4 MB) with the server's OCR provider and answers `{read: {text, name,
 * date, provider}}` for the owner to check. Nothing is saved: the manual add
 * that follows keeps the image as the testimonial's screenshot.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  // The image and the multipart wrapping around it.
  const raw = await readCappedBytes(req, MAX_OCR_BYTES + 64 * 1024);
  if (!raw) return jsonError(413, `Screenshots up to ${MAX_OCR_BYTES / 1024 / 1024} MB can be read`);
  const form = await new Response(new Uint8Array(raw), { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File) || !file.size) return jsonError(400, "Attach the screenshot as `image`");
  try {
    const read = await readScreenshot(project, Buffer.from(await file.arrayBuffer()));
    if (read.provider === "ai") auditRequest(req, "ocr.ai", { objectType: "project", objectId: project.id, projectId: project.id, summary: "Sent a screenshot to the AI provider to read it" });
    return Response.json({ read }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof OcrError) return jsonError(err.status, err.message);
    throw err;
  }
}
