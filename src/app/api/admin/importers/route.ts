import { requireAdmin } from "@/lib/http";
import { listImporters } from "@/lib/importers/registry";

/** The review sites and tools Plaudit can import from, with how each one reads and whether it's set up here. */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return Response.json({ importers: listImporters() });
}
