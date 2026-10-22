import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

/**
 * Outgoing email through the owner's own SMTP server (SMTP_URL), so there is
 * no per-email cost and mail comes from the owner's domain. With
 * MAIL_OUTBOX=true, messages are written to DATA_DIR/mail-outbox as .eml
 * files instead, which is handy for trying things out locally.
 * Messages are plain text: no tracking pixels, no remote images.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

export function emailMode(): "smtp" | "outbox" | "off" {
  if (env.smtpUrl) return "smtp";
  if (env.mailOutbox) return "outbox";
  return "off";
}

export function emailEnabled() {
  return emailMode() !== "off";
}

let transport: { key: string; transporter: Transporter } | null = null;

function smtp() {
  const key = env.smtpUrl;
  if (!transport || transport.key !== key) transport = { key, transporter: nodemailer.createTransport(key) };
  return transport.transporter;
}

export function outboxDir() {
  return path.join(env.dataDir, "mail-outbox");
}

/** One line, no control characters: keeps user-supplied names out of other headers. */
export function headerSafe(value: string) {
  return value.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
}

export async function sendMail(mail: Mail) {
  const message = {
    from: env.smtpFrom,
    to: mail.to,
    subject: headerSafe(mail.subject),
    text: mail.text,
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

/** Fills `{name}`-style placeholders. Unknown placeholders are left as they are. */
export function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}
