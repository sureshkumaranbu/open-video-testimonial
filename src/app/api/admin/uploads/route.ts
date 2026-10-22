import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/http";
import { CHUNK_MAX_BYTES, createUpload } from "@/lib/uploads";

/** Starts a resumable upload of an export archive (see /api/uploads/:id). */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { upload, token } = createUpload("import", { maxBytes: env.maxImportBytes });
  return Response.json({ id: upload.id, token, offset: 0, chunkSize: CHUNK_MAX_BYTES }, { status: 201 });
}
