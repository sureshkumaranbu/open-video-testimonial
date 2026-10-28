import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { OnboardingError, runWizard, scanAllowed, setWelcome, wizardBody } from "@/lib/onboarding";
import { firstIssue } from "@/lib/validation";

/**
 * The first-run wizard (ONB-01): makes the project and its starter assets,
 * and starts the brand scan of the website in the background (ONB-02), whose
 * run the wizard follows. `{skip: true}` hides the dashboard's Get started
 * card instead.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const email = getRequestSession(req)!.email;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.skip === true) {
    setWelcome(email, "skipped");
    return Response.json({ ok: true });
  }
  const parsed = wizardBody.safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  if (parsed.data.website && !scanAllowed()) return jsonError(429, "Too many site scans. Please try again later, or leave the website out for now.");
  try {
    const { project, scan } = await runWizard(parsed.data, { by: email });
    return Response.json({ project: { id: project.id, slug: project.slug, name: project.name }, scan }, { status: 201 });
  } catch (err) {
    if (err instanceof OnboardingError) return jsonError(err.status, err.message);
    throw err;
  }
}
