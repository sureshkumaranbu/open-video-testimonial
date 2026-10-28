import { z } from "zod";
import { jsonError, requireRole } from "@/lib/http";
import { ImportError } from "@/lib/importers/run";
import { importDiscovered, OnboardingError } from "@/lib/onboarding";
import { firstIssue } from "@/lib/validation";

const body = z.object({
  projectId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  selection: z.union([z.literal("all"), z.array(z.string().min(1).max(200)).min(1, "Choose at least one testimonial").max(50)]),
});

/** Imports the testimonials the owner chose from their site, as approved (ONB-03). */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ run: importDiscovered(parsed.data.projectId, parsed.data.runId, parsed.data.selection) });
  } catch (err) {
    if (err instanceof OnboardingError || err instanceof ImportError) return jsonError(err.status, err.message);
    throw err;
  }
}
