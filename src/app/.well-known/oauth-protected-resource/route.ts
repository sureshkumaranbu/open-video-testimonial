import { featureOn } from "@/lib/features";
import { oauthJson, protectedResourceMetadata } from "@/lib/oauth";

/** RFC 9728 protected-resource metadata for /mcp (INT-04). */
export function GET() {
  if (!featureOn("mcp")) return new Response("Not found", { status: 404 });
  return oauthJson(protectedResourceMetadata());
}
