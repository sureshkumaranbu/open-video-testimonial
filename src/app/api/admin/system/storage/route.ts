import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole, requireOwner } from "@/lib/http";
import { storageStatus } from "@/lib/storage";
import { latestStorageMigration, localMediaKeys, startStorageMigration, StorageMigrationError } from "@/lib/storage-migrate";
import { firstIssue } from "@/lib/validation";

/** Where media is stored, whether it works, and the latest "Copy local media to S3" run. */
export async function GET(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const [storage, keys] = await Promise.all([storageStatus({ fresh: true }), localMediaKeys()]);
  return Response.json({ storage: { ...storage, localFiles: keys.length }, migration: latestStorageMigration() });
}

const schema = z.object({ deleteLocal: z.boolean().optional() }).strict();

/** Starts copying local media to the bucket (owner only). Poll GET /api/admin/runs/[id] for progress. */
export async function POST(req: Request) {
  const denied = requireOwner(req);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const run = await startStorageMigration({ deleteLocal: parsed.data.deleteLocal, by: getRequestSession(req)?.email });
    return Response.json({ run }, { status: 201 });
  } catch (err) {
    if (err instanceof StorageMigrationError) return jsonError(409, err.message);
    throw err;
  }
}
