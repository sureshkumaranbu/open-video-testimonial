import { emailEnabled, sendMail } from "./email";
import { env } from "./env";
import { createLoginToken } from "./login-links";

/**
 * Sends (or, without email, returns) an invitation link. It signs the
 * invitee in and activates them; it works once, for 72 hours.
 */
export async function sendInvite(email: string, invitedBy: string) {
  const link = `${env.publicUrl}/admin/login/link?token=${createLoginToken(email, "invite")}`;
  if (!emailEnabled()) return { sent: false as const, link };
  await sendMail({
    to: email,
    subject: "You're invited to Plaudit",
    text: `${invitedBy} has invited you to help manage testimonials on Plaudit at ${env.publicUrl}.

Accept the invitation and sign in:
${link}

The link works once, for 72 hours. After that, sign in at ${env.publicUrl}/admin/login with this address.
`,
  });
  return { sent: true as const };
}
