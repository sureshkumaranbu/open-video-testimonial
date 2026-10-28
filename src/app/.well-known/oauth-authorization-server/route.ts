import { featureOn } from "@/lib/features";
import { authServerMetadata, oauthJson } from "@/lib/oauth";

/** RFC 8414 authorization-server metadata (INT-04). */
export function GET() {
  if (!featureOn("mcp")) return new Response("Not found", { status: 404 });
  return oauthJson(authServerMetadata());
}
