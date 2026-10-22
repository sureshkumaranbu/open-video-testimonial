import { env } from "@/lib/env";
import { openApiSpec } from "@/lib/openapi";

/** The machine-readable API description (no key needed). */
export function GET() {
  return Response.json(openApiSpec(env.publicUrl), { headers: { "Access-Control-Allow-Origin": "*" } });
}
