import { requireAdmin } from "@/lib/http";
import { systemStatus } from "@/lib/system";

/** Which optional features are available on this server. */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return Response.json(await systemStatus());
}
