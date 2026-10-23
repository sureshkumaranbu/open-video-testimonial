import { env } from "@/lib/env";
import { jsonError, requireAdmin } from "@/lib/http";
import { tooLarge } from "@/lib/sniff";
import { CHUNK_MAX_BYTES, createUpload } from "@/lib/uploads";

/** Starts a resumable upload of an export archive (see /api/uploads/:id). */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { size?: unknown };
  if (typeof body.size === "number" && body.size > env.maxImportBytes) return jsonError(413, tooLarge(env.maxImportBytes));
  const { upload, token } = createUpload("import", { maxBytes: env.maxImportBytes });
  return Response.json({ id: upload.id, token, offset: 0, chunkSize: CHUNK_MAX_BYTES }, { status: 201 });
}
