import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

/**
 * Outgoing email through the owner's own SMTP server (SMTP_URL, or SMTP_HOST
 * and friends), so there is
 * no per-email cost and mail comes from the owner's domain. With
 * MAIL_OUTBOX=true, messages are written to DATA_DIR/mail-outbox as .eml
 * files instead, which is handy for trying things out locally.
 * Messages are plain text. Campaign emails (M9) add an HTML part with a
 * button; only a campaign that opted in carries an open pixel, and it loads
 * from this server.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Shown as the sender's name; the address is always SMTP_FROM's. */
  fromName?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

/** The bare address in SMTP_FROM ("Acme <hello@acme.com>" gives hello@acme.com). */
export function fromAddress(from = env.smtpFrom) {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

/** How long to wait on a mail server, so a wrong host or port fails in seconds rather than minutes. */
const TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000 };

/** The SMTP transport settings, or null when no mail server is configured. */
function smtpOptions() {
  if (env.smtpUrl) return { url: env.smtpUrl, ...TIMEOUTS };
  if (!env.smtpHost) return null;
  const port = env.smtpPort || (env.smtpSecure ? 465 : 587);
  return {
    host: env.smtpHost,
    port,
    secure: env.smtpSecure ?? port === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
    ...TIMEOUTS,
  };
}

export function emailMode(): "smtp" | "outbox" | "off" {
  if (smtpOptions()) return "smtp";
  if (env.mailOutbox) return "outbox";
  return "off";
}

export function emailEnabled() {
  return emailMode() !== "off";
}

let transport: { key: string; transporter: Transporter } | null = null;

function smtp() {
  const options = smtpOptions()!;
  const key = JSON.stringify(options);
  if (!transport || transport.key !== key) transport = { key, transporter: nodemailer.createTransport(options) };
  return transport.transporter;
}

/** Real mail servers refuse the placeholder sender, so the dashboard warns about it. */
export function fromWarning() {
  if (emailMode() !== "smtp" || env.smtpFromSet) return null;
  return "SMTP_FROM isn't set, so mail goes out as no-reply@localhost, which real mail servers refuse. Set SMTP_FROM to an address your provider lets you send from.";
}

export function outboxDir() {
  return path.join(env.dataDir, "mail-outbox");
}

/** One line, no control characters: keeps user-supplied names out of other headers. */
export function headerSafe(value: string) {
  return value.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
}

export async function sendMail(mail: Mail) {
  const name = mail.fromName ? headerSafe(mail.fromName) : "";
  const message = {
    from: name ? { name, address: fromAddress() } : env.smtpFrom,
    to: mail.to,
    subject: headerSafe(mail.subject),
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    headers: mail.headers,
  };
  const mode = emailMode();
  if (mode === "off") throw new Error("Email isn't set up (SMTP_URL)");
  if (mode === "smtp") {
    const info = await smtp().sendMail(message);
    return { messageId: info.messageId as string };
  }
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(message);
  const dir = outboxDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${crypto.randomUUID()}.eml`);
  await fs.promises.writeFile(file, built.message as Buffer);
  return { messageId: built.messageId as string, file };
}

/**
 * True for an error where the receiving server refused the address itself
 * (a 5xx to RCPT TO, or a 5.1.x status): the campaign shows it as bounced.
 * There's no inbound bounce processing; this is what the send itself says.
 */
export function isRecipientRejection(err: unknown) {
  const e = err as SmtpError & { command?: string };
  if (!(e instanceof Error)) return false;
  const code = e.responseCode ?? 0;
  if (code < 500 || code >= 600) return false;
  return /RCPT/i.test(e.command ?? "") || /\b5\.1\.\d\b|recipient|mailbox|user unknown|no such user|does not exist/i.test(`${e.message} ${e.response ?? ""}`);
}

/** Fills `{name}`-style placeholders. Unknown placeholders are left as they are. */
export function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}

// ------------------------------------------------------------------ errors

type SmtpError = Error & { code?: string; responseCode?: number; response?: string };

/**
 * Errors that will fail the same way next time: the server refused the login,
 * the sender or the message (5xx). Connection problems and 4xx are worth a retry.
 */
export function isPermanentSmtpError(err: unknown) {
  const e = err as SmtpError;
  if (!(e instanceof Error)) return false;
  const code = e.responseCode ?? 0;
  if (code >= 400 && code < 500) return false;
  return e.code === "EAUTH" || e.code === "ENOAUTH" || (code >= 500 && code < 600);
}

/** A plain-English next step for a mail server error, or null if there's nothing specific to say. */
export function explainSmtpError(err: unknown): string | null {
  const e = err as SmtpError;
  if (!(e instanceof Error)) return null;
  const text = `${e.code ?? ""} ${e.message} ${e.response ?? ""}`;
  const code = e.responseCode ?? 0;
  if (e.code === "EAUTH" || e.code === "ENOAUTH" || code === 535 || code === 534) {
    return "The mail server refused the username or password. Check them, and note that Gmail, Zoho with two-factor sign-in, and many others need an app password rather than your normal one. In SMTP_URL an @ in the username must be written %40 (or use SMTP_USER and SMTP_PASSWORD instead).";
  }
  if (/wrong version number|ssl3_get_record|packet length too long|Greeting never received/i.test(text)) {
    return "The TLS setting doesn't match the port. Port 465 needs smtps:// (or SMTP_SECURE=true); ports 587, 25 and 2525 need smtp:// (or SMTP_SECURE=false).";
  }
  if (/self[- ]signed|unable to verify|certificate|altnames|ETLS/i.test(text)) {
    return "The mail server's certificate wasn't accepted. Use the host name your provider gives (not an IP address or a different name), and check that smtp:// or smtps:// matches the port.";
  }
  if (/ENOTFOUND|EAI_AGAIN|EDNS/.test(text)) {
    return "That mail server host name doesn't exist. Check the spelling in SMTP_URL or SMTP_HOST.";
  }
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ECONNECTION|ESOCKET|timed? ?out/i.test(text)) {
    return "Couldn't reach the mail server. Check the host and port. Many hosting providers (DigitalOcean, Hetzner, Linode and others) block outgoing mail ports: try port 587 or 2525, or ask your host to unblock them.";
  }
  if (/Recipient command failed|all recipients were rejected/i.test(text)) {
    return "The mail server refused the recipient address. Check its spelling. Some services only send to verified addresses until you leave their trial (Amazon SES's sandbox, for example).";
  }
  if (/Mail command failed/i.test(text) || ((code === 550 || code === 553 || code === 554) && /sender|from address|send as|not owned|not allowed|5\.7\.(1|60)|relay/i.test(text))) {
    return "The mail server won't send from SMTP_FROM. Use the account's own address, or an alias or domain you've verified with your provider.";
  }
  return null;
}
