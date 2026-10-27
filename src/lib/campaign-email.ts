import { headerSafe, type Mail } from "./email";
import { INK, normalizeHex, textOn } from "./contrast";

/**
 * Campaign emails (M9, REQ-01 and REQ-03). One function builds both the
 * dashboard's live preview and the message the worker sends, so the preview
 * is the mail. It has no database access: callers pass the wording, the
 * person and the links.
 *
 * Templates take `{{name}}` (full name), `{{first_name}}`, `{{company}}`,
 * `{{title}}`, `{{project}}`, `{{link}}` and the person's own custom
 * variables. The Requests tab's single-brace style (`{name}` is the first
 * name, as it always was) works too.
 */

export type CampaignContent = {
  subject: string;
  body: string;
  buttonText: string;
  rtl: boolean;
  senderName: string;
  replyTo: string;
};

export type CampaignRecipient = {
  name?: string | null;
  email: string;
  company?: string | null;
  title?: string | null;
  custom?: Record<string, string>;
};

export type CampaignLinks = {
  /** The personal link (through the click redirect for a real recipient). */
  link: string;
  decline: string;
  unsubscribe: string;
  /** RFC 8058 one-click unsubscribe endpoint (POST). */
  oneClick: string;
  /** The open pixel, only for a campaign that turned open tracking on (never in previews). */
  open?: string | null;
};

export const DEFAULT_CAMPAIGN_SUBJECT = "{{first_name}}, would you share a few words about {{project}}?";
export const DEFAULT_CAMPAIGN_BODY = `Hi {{first_name}},

Thanks for being a customer of {{project}}. Would you share a short testimonial? It takes about two minutes: write a few lines or record a quick video, whichever you prefer.

{{link}}

Thank you!`;
export const DEFAULT_BUTTON_TEXT = "Share your experience";

/** The variables every template knows, for the editor's hint. */
export const TEMPLATE_VARIABLES = ["name", "first_name", "company", "title", "project", "link"] as const;

/** Custom variable names: letters, digits and underscores, so `{{plan}}` stays unambiguous. */
export const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || "";
}

/** The values a template is filled with. Built-ins win over custom variables of the same name. */
export function templateValues(projectName: string, r: CampaignRecipient, link: string): Record<string, string> {
  const name = r.name?.trim() || "";
  return {
    ...(r.custom ?? {}),
    name: name || "there",
    first_name: firstName(name) || "there",
    company: r.company?.trim() || "",
    title: r.title?.trim() || "",
    project: projectName,
    link,
  };
}

/**
 * Fills `{{key}}` and `{key}` in one pass, so a value that itself contains
 * braces is never filled again. Unknown placeholders stay as they are.
 */
export function fillVariables(template: string, values: Record<string, string>) {
  // Single braces keep the Requests tab's meaning: {name} is the first name.
  const single: Record<string, string> = { ...values, name: values.first_name ?? values.name ?? "" };
  return template.replace(/\{\{\s*([A-Za-z][\w]*)\s*\}\}|\{([A-Za-z][\w]*)\}/g, (match, double?: string, one?: string) => {
    if (double) return Object.hasOwn(values, double) ? values[double] : match;
    return one && Object.hasOwn(single, one) ? single[one] : match;
  });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Text paragraphs as HTML; the personal link becomes a link, and on a line of its own, the button. */
function bodyHtml(text: string, link: string, button: string) {
  const escapedLink = escapeHtml(link);
  let hasButton = false;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (p === link) {
        hasButton = true;
        return button;
      }
      const html = escapeHtml(p)
        .split(escapedLink)
        .join(`<a href="${escapedLink}" style="color:inherit;">${escapedLink}</a>`)
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 16px;">${html}</p>`;
    });
  if (!hasButton) paragraphs.push(button);
  return paragraphs.join("\n");
}

/**
 * The campaign email for one person: subject, plain text and an HTML part
 * with a button. `kind` "reminder" adds a short line and "Reminder:".
 */
export function renderCampaignEmail(o: {
  projectName: string;
  accentColor: string;
  content: CampaignContent;
  recipient: CampaignRecipient;
  links: CampaignLinks;
  kind: "invite" | "reminder";
}): Mail & { html: string } {
  const { content, recipient, links, kind } = o;
  const values = templateValues(o.projectName, recipient, links.link);
  const subject = fillVariables(content.subject.trim() || DEFAULT_CAMPAIGN_SUBJECT, values);
  let body = fillVariables(content.body.trim() || DEFAULT_CAMPAIGN_BODY, values).replace(/\r\n?/g, "\n");
  if (kind === "reminder") body = `Just a gentle reminder in case this got buried.\n\n${body}`;
  const buttonText = content.buttonText.trim() || DEFAULT_BUTTON_TEXT;
  const project = headerSafe(o.projectName);

  // The link is always in the text part, even if the owner's wording dropped it.
  const textBody = body.includes(links.link) ? body : `${body}\n\n${buttonText}: ${links.link}`;
  const text = `${textBody}\n\n--\nYou're getting this because ${project} asked for your feedback.\nNo thanks? ${links.decline}\nTo stop these emails: ${links.unsubscribe}\n`;

  const accent = normalizeHex(o.accentColor) ?? "#0f766e";
  const dir = content.rtl ? "rtl" : "ltr";
  const button = `<p style="margin:24px 0;"><a href="${escapeHtml(links.link)}" style="display:inline-block;background:${accent};color:${textOn(accent)};padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;">${escapeHtml(buttonText)}</a></p>`;
  const pixel = links.open ? `\n<img src="${escapeHtml(links.open)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">` : "";
  const html = `<!doctype html>
<html dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<div dir="${dir}" style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:${INK};text-align:${content.rtl ? "right" : "left"};">
<div style="background:#ffffff;border-radius:8px;padding:24px;">
${bodyHtml(body, links.link, button)}
</div>
<p style="margin:16px 0 0;font-size:13px;color:#5b6275;">You're getting this because ${escapeHtml(project)} asked for your feedback. <a href="${escapeHtml(links.decline)}" style="color:#5b6275;">No thanks</a> · <a href="${escapeHtml(links.unsubscribe)}" style="color:#5b6275;">Unsubscribe</a></p>${pixel}
</div>
</body>
</html>
`;
  return {
    to: recipient.email,
    subject: kind === "reminder" ? `Reminder: ${subject}` : subject,
    text,
    html,
    fromName: content.senderName.trim() || undefined,
    replyTo: content.replyTo.trim() || undefined,
    headers: {
      // One-click unsubscribe (RFC 8058) for mail apps that support it.
      "List-Unsubscribe": `<${links.oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
