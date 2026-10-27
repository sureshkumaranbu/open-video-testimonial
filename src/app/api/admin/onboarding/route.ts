import { getRequestSession } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/http";
import { OnboardingError, runWizard, setWelcome, wizardBody } from "@/lib/onboarding";
import { firstIssue } from "@/lib/validation";

/**
 * The first-run wizard (ONB-01): makes the project, reads the website for its
 * brand and testimonials, and sets up the starter assets. `{skip: true}`
 * hides the dashboard's Get started card instead.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const email = getRequestSession(req)!.email;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.skip === true) {
    setWelcome(email, "skipped");
    return Response.json({ ok: true });
  }
  const parsed = wizardBody.safeParse(body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const { project, discovery } = await runWizard(parsed.data, { by: email });
    return Response.json({ project: { id: project.id, slug: project.slug, name: project.name }, discovery }, { status: 201 });
  } catch (err) {
    if (err instanceof OnboardingError) return jsonError(err.status, err.message);
    throw err;
  }
}
