import { getRequestSession } from "@/lib/auth";
import { jsonError, requireRole } from "@/lib/http";
import { getInboxPrefs, inboxPrefsSchema, saveInboxPrefs } from "@/lib/inbox";
import { firstIssue } from "@/lib/validation";

/** The signed-in person's inbox view: card or table, sort, direction and page size (INBOX-04). */
export async function GET(req: Request) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  return Response.json({ ui: getInboxPrefs(getRequestSession(req)?.email) });
}

export async function PUT(req: Request) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const email = getRequestSession(req)?.email;
  if (!email) return jsonError(401, "Sign in to save your view.");
  const body = (await req.json().catch(() => null)) as { ui?: unknown } | null;
  const parsed = inboxPrefsSchema.safeParse(body?.ui ?? body);
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  return Response.json({ ui: saveInboxPrefs(email, parsed.data) });
}
