import { z } from "zod";
import { emailMode, explainSmtpError, sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { jsonError, requireRole } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { firstIssue } from "@/lib/validation";

const schema = z.object({ to: z.email("Enter a valid email address").max(254).optional().or(z.literal("")) });

/**
 * Sends a test email now and reports exactly what the mail server said, with
 * a hint for the common setup mistakes.
 */
export async function POST(req: Request) {
  const denied = requireRole(req, "admin");
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const mode = emailMode();
  if (mode === "off") return jsonError(400, "Email isn't set up on this server. Set SMTP_URL (or SMTP_HOST) and restart.");
  const to = parsed.data.to || env.adminEmail;
  if (!to) return jsonError(400, "Enter an address to send the test to");
  if (!rateLimit("email-test", 10, 10 * 60 * 1000)) {
    return jsonError(429, "That's a lot of test emails. Please wait a few minutes and try again.");
  }
  try {
    const sent = await sendMail({
      to,
      subject: "Plaudit test email",
      text: `This is a test email from your Plaudit server at ${env.publicUrl}.

If you can read it, email works: invitations, reminders and receipts will be sent as ${env.smtpFrom}.
`,
    });
    return Response.json({ ok: true, to, mode, file: sent.file ? true : undefined });
  } catch (err) {
    const e = err as Error & { code?: string; responseCode?: number };
    return Response.json(
      { error: e.message, code: e.code ?? null, responseCode: e.responseCode ?? null, hint: explainSmtpError(err) },
      { status: 502 },
    );
  }
}
