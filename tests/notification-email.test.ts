import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { runDueJobs } from "@/lib/jobs";
import { recordSignIn } from "@/lib/members";
import { runDigests } from "@/lib/notifications";
import { setPrefs } from "@/lib/notifications/prefs";
import { createProject } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { simpleParser } from "./mail-parse";
import { ADMIN_EMAIL, params, submissionForm, submitRequest, useTempDataDir } from "./helpers";

/** Owner notifications through a real SMTP conversation (INT-01). */
const inbox: { to: string; raw: string }[] = [];
let smtp: SMTPServer;
let port = 0;

beforeAll(async () => {
  smtp = new SMTPServer({
    disabledCommands: ["STARTTLS", "AUTH"],
    logger: false,
    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        inbox.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), raw: Buffer.concat(chunks).toString() });
        done();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  port = (smtp.server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  inbox.length = 0;
  process.env.SMTP_URL = `smtp://127.0.0.1:${port}`;
  process.env.SMTP_FROM = "plaudit@acme.example";
  process.env.PUBLIC_URL = "https://plaudit.example";
  createProject({ name: "Acme", slug: "acme" });
});
afterEach(() => {
  for (const k of ["SMTP_URL", "SMTP_FROM", "PUBLIC_URL"]) delete process.env[k];
  ctx.cleanup();
});

const send = (text: string) =>
  submit(submitRequest("acme", submissionForm({ name: "Ada Lovelace", consent: "on", rating: "4", text })), params({ slug: "acme" }));

describe("notification emails over SMTP", () => {
  it("INT-01 sends nothing until the person turns it on", async () => {
    recordSignIn(ADMIN_EMAIL);
    await send("Quietly received.");
    await runDueJobs();
    expect(inbox).toEqual([]);
  });

  it("INT-01 an instant email is plain text with the quote, stars and a review link", async () => {
    recordSignIn(ADMIN_EMAIL);
    setPrefs(ADMIN_EMAIL, { newTestimonial: "instant" });
    await send("Lovely to work with.\r\nBcc: someone@evil.example");
    await runDueJobs();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].to).toBe(ADMIN_EMAIL);
    const mail = await simpleParser(inbox[0].raw);
    expect(mail.subject).toBe("New testimonial for Acme (4/5) from Ada Lovelace");
    expect(mail.headers["content-type"]).toMatch(/^text\/plain/);
    expect(mail.headers["auto-submitted"]).toBe("auto-generated");
    expect(mail.headers.bcc).toBeUndefined();
    expect(mail.text).toContain("★★★★☆");
    expect(mail.text).toContain("Lovely to work with.");
    expect(mail.text).toMatch(/https:\/\/plaudit\.example\/admin\/projects\/[\w-]+\?open=[\w-]+/);
  });

  it("INT-01 the daily digest arrives once", async () => {
    recordSignIn(ADMIN_EMAIL);
    setPrefs(ADMIN_EMAIL, { newTestimonial: "daily" });
    await send("One");
    await send("Two");
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect(runDigests(later)).toBe(1);
    expect(runDigests(later)).toBe(0);
    await runDueJobs();
    expect(inbox).toHaveLength(1);
    const mail = await simpleParser(inbox[0].raw);
    expect(mail.subject).toBe("2 new testimonials in the last day");
  });
});
