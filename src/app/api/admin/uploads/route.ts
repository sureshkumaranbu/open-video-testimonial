import { env } from "@/lib/env";
import { jsonError, requireAdmin } from "@/lib/http";
import { tooLarge } from "@/lib/sniff";
import { getProjectById } from "@/lib/testimonials";
import { CHUNK_MAX_BYTES, createUpload } from "@/lib/uploads";

/**
 * Starts a resumable upload (chunks go to /api/uploads/:id): an export
 * archive by default, or `{kind: "video", projectId}` for a video added by
 * hand in the inbox. `kind` and `projectId` may also be query parameters,
 * since the resumable client sends only `{size}` in the body.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const json = (await req.json().catch(() => ({}))) as { size?: unknown; kind?: unknown; projectId?: unknown } | null;
  const sp = new URL(req.url).searchParams;
  const body = { ...json, kind: json?.kind ?? sp.get("kind") ?? undefined, projectId: json?.projectId ?? sp.get("projectId") ?? undefined };
  if (body.kind === "video") {
    const project = typeof body.projectId === "string" ? getProjectById(body.projectId) : null;
    if (!project) return jsonError(404, "Project not found");
    if (typeof body.size === "number" && body.size > env.maxVideoBytes) return jsonError(413, tooLarge(env.maxVideoBytes));
    const { upload, token } = createUpload("video", { projectId: project.id, maxBytes: env.maxVideoBytes });
    return Response.json({ id: upload.id, token, offset: 0, chunkSize: CHUNK_MAX_BYTES }, { status: 201 });
  }
  if (body.kind !== undefined && body.kind !== "import") return jsonError(400, "Choose an upload kind: import or video");
  if (typeof body.size === "number" && body.size > env.maxImportBytes) return jsonError(413, tooLarge(env.maxImportBytes));
  const { upload, token } = createUpload("import", { maxBytes: env.maxImportBytes });
  return Response.json({ id: upload.id, token, offset: 0, chunkSize: CHUNK_MAX_BYTES }, { status: 201 });
}
