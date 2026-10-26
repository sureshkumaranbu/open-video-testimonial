import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { discover, OnboardingError } from "@/lib/onboarding";
import { firstIssue } from "@/lib/validation";

const body = z.object({ projectId: z.string().min(1).max(64), url: z.string().trim().min(1, "Enter your website").max(500) });

/** Looks for testimonials on the owner's site again (ONB-03), for a project that already exists. */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ discovery: await discover(parsed.data.projectId, parsed.data.url, { by: getRequestSession(req)?.email }) });
  } catch (err) {
    if (err instanceof OnboardingError) return jsonError(err.status, err.message);
    throw err;
  }
}
