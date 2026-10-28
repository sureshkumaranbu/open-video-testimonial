import { z } from "zod";
import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { getDiscovery, OnboardingError, scanAllowed, startDiscovery } from "@/lib/onboarding";
import { firstIssue } from "@/lib/validation";

const id = z.string().min(1).max(64);
const body = z.object({ projectId: id, url: z.string().trim().min(1, "Enter your website").max(500) });
const query = z.object({ projectId: id, runId: id });

/** Scans the owner's site again (ONB-02/03) for a project that already exists. Answers with the run to follow. */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (!scanAllowed()) return jsonError(429, "Too many site scans. Please try again later.");
  try {
    return Response.json({ run: startDiscovery(parsed.data.projectId, parsed.data.url, { by: getRequestSession(req)?.email }) }, { status: 201 });
  } catch (err) {
    if (err instanceof OnboardingError) return jsonError(err.status, err.message);
    throw err;
  }
}

/** A scan's progress and, once it has finished, what it found: the brand and the testimonials to choose from. */
export async function GET(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const url = new URL(req.url);
  const parsed = query.safeParse({ projectId: url.searchParams.get("projectId"), runId: url.searchParams.get("runId") });
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const scan = getDiscovery(parsed.data.projectId, parsed.data.runId);
  if (!scan) return jsonError(404, "Scan not found");
  return Response.json(scan);
}
