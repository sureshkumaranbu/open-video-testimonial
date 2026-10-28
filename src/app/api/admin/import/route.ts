import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "@/lib/env";
import { jsonError, requireRole } from "@/lib/http";
import { enqueue } from "@/lib/jobs";
import { createImportTarget, IMPORT_JOB, ImportError, readManifest } from "@/lib/portability";
import { discardUpload, getUpload, uploadFilePath } from "@/lib/uploads";
import { firstIssue } from "@/lib/validation";

const schema = z.object({
  uploadId: z.string(),
  token: z.string(),
  name: z.string().trim().max(80).optional(),
  slug: z.string().trim().toLowerCase().max(48).optional(),
});

/**
 * Imports a Plaudit export as a new project. The archive is checked here;
 * copying the media runs in the background (poll /api/admin/jobs/:id).
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const upload = getUpload(parsed.data.uploadId, parsed.data.token);
  if (!upload || upload.kind !== "import") return jsonError(400, "The upload has expired. Please upload the file again.");

  // Keep the archive outside the upload session so cleanup can't remove it mid-import.
  const zipPath = path.join(env.tmpDir, `import-${upload.id}.zip`);
  await fs.promises.rename(uploadFilePath(upload), zipPath);
  await discardUpload(upload.id);
  try {
    const { manifest } = await readManifest(zipPath);
    const project = createImportTarget(manifest, parsed.data);
    const job = enqueue(IMPORT_JOB, { zipPath, projectId: project.id }, { maxAttempts: 1 });
    return Response.json(
      { project, jobId: job.id, counts: { testimonials: manifest.testimonials.length, requests: manifest.requests.length } },
      { status: 202 },
    );
  } catch (err) {
    await fs.promises.rm(zipPath, { force: true });
    if (err instanceof ImportError) return jsonError(400, err.message);
    throw err;
  }
}
