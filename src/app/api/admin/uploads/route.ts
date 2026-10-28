import { directReply, directRequest, openDirect, sessionLimit } from "@/lib/direct-upload";
import { env } from "@/lib/env";
import { getRequestSession } from "@/lib/auth";
import { roleAtLeast } from "@/lib/access";
import { jsonError, requireProjectAccess, requireRole } from "@/lib/http";
import { tooLarge } from "@/lib/sniff";
import { getProjectById } from "@/lib/testimonials";
import { CHUNK_MAX_BYTES, createUpload } from "@/lib/uploads";

/**
 * Starts a resumable upload (chunks go to /api/uploads/:id): an export
 * archive by default, or `{kind: "video", projectId}` for a video added by
 * hand in the inbox. `kind` and `projectId` may also be query parameters,
 * since the resumable client sends only `{size}` (and `{direct, contentType}`,
 * L9) in the body. Videos may go straight to the bucket; archives never do.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const json = (await req.json().catch(() => ({}))) as { size?: unknown; kind?: unknown; projectId?: unknown; direct?: unknown; contentType?: unknown } | null;
  const sp = new URL(req.url).searchParams;
  const body = { ...json, kind: json?.kind ?? sp.get("kind") ?? undefined, projectId: json?.projectId ?? sp.get("projectId") ?? undefined };
  if (body.kind === "video") {
    const project = typeof body.projectId === "string" ? getProjectById(body.projectId) : null;
    if (!project) return jsonError(404, "Project not found");
    const no = requireProjectAccess(req, project.id);
    if (no) return no;
    if (typeof body.size === "number" && body.size > env.maxVideoBytes) return jsonError(413, tooLarge(env.maxVideoBytes));
    const direct = directRequest(json);
    const created = createUpload("video", { projectId: project.id, maxBytes: sessionLimit(direct, body.size, env.maxVideoBytes), direct });
    const upload = await openDirect(created.upload);
    return Response.json({ id: upload.id, token: created.token, offset: 0, chunkSize: CHUNK_MAX_BYTES, ...directReply(upload) }, { status: 201 });
  }
  if (body.kind !== undefined && body.kind !== "import") return jsonError(400, "Choose an upload kind: import or video");
  // An archive becomes a new project, which only admins may add (TEAM-01).
  if (!roleAtLeast(getRequestSession(req)!.role, "admin")) return jsonError(403, "Only an admin can do this");
  if (typeof body.size === "number" && body.size > env.maxImportBytes) return jsonError(413, tooLarge(env.maxImportBytes));
  const { upload, token } = createUpload("import", { maxBytes: env.maxImportBytes });
  return Response.json({ id: upload.id, token, offset: 0, chunkSize: CHUNK_MAX_BYTES }, { status: 201 });
}
