import { featureOn } from "@/lib/features";
import { oauthJson, revokeToken } from "@/lib/oauth";
import { preflight, readFields } from "../cors";

/** RFC 7009: always 200, whether or not the token was known. */
export async function POST(req: Request) {
  if (!featureOn("mcp")) return new Response("Not found", { status: 404 });
  const f = await readFields(req);
  revokeToken(f?.get("token"));
  return oauthJson({});
}

export const OPTIONS = preflight;
