import { getRequestSession } from "@/lib/auth";
import { draftContent, sendCampaignTest } from "@/lib/campaigns";
import { emailMode, explainSmtpError, fromAddress } from "@/lib/email";
import { jsonError, requireRole } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { checkSenderDomain } from "@/lib/sender-auth";
import { firstIssue } from "@/lib/validation";
import { campaignAndProject } from "../guard";

/**
 * REQ-03 and REQ-06: "Send a test to me" sends the campaign's email (with
 * the editor's unsaved wording and a sample person) to the signed-in member,
 * and reports what the From domain publishes for SPF and DMARC. The DNS check
 * only reports; it never stops a send.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = campaignAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Campaign not found");
  const parsed = draftContent.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const mode = emailMode();
  if (mode === "off") return jsonError(409, "Email isn't set up on this server. Set SMTP_URL (or SMTP_HOST) and restart.");
  const to = getRequestSession(req)?.email;
  if (!to) return jsonError(400, "Your account has no email address to send the test to");
  if (!rateLimit(`campaign-test:${to}`, 10, 10 * 60 * 1000)) {
    return jsonError(429, "That's a lot of test emails. Please wait a few minutes and try again.");
  }
  const auth = await checkSenderDomain(fromAddress());
  try {
    const { mail } = await sendCampaignTest(found.project, found.campaign, parsed.data, to);
    return Response.json({ ok: true, to, mode, subject: `[Test] ${mail.subject}`, auth });
  } catch (err) {
    const e = err as Error & { code?: string; responseCode?: number };
    return Response.json(
      { error: e.message, code: e.code ?? null, responseCode: e.responseCode ?? null, hint: explainSmtpError(err), auth },
      { status: 502 },
    );
  }
}
