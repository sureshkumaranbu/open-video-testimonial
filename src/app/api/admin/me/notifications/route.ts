import { getRequestSession } from "@/lib/auth";
import { emailMode } from "@/lib/email";
import { jsonError, requireRole } from "@/lib/http";
import { getPrefs, prefsPatchSchema, setPrefs } from "@/lib/notifications/prefs";
import { firstIssue } from "@/lib/validation";

/** The signed-in person's email notifications (INT-01). Everyone edits only their own. */
export function GET(req: Request) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const email = getRequestSession(req)!.email;
  return Response.json({ email, emailMode: emailMode(), notifications: getPrefs(email) });
}

export async function PUT(req: Request) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const email = getRequestSession(req)?.email;
  if (!email) return jsonError(401, "Sign in to save your notifications.");
  const body = (await req.json().catch(() => null)) as { notifications?: unknown } | null;
  const parsed = prefsPatchSchema.strict().safeParse(body?.notifications ?? body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  return Response.json({ email, emailMode: emailMode(), notifications: setPrefs(email, parsed.data) });
}
