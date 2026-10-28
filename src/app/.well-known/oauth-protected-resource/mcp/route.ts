import { featureOn } from "@/lib/features";
import { oauthJson, protectedResourceMetadata } from "@/lib/oauth";

/** The same metadata at the path RFC 9728 derives from the resource URL (…/mcp). */
export function GET() {
  if (!featureOn("mcp")) return new Response("Not found", { status: 404 });
  return oauthJson(protectedResourceMetadata());
}
