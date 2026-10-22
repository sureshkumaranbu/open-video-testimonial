import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { simpleParser } from "./mail-parse";
import { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchProject } from "@/app/api/admin/projects/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/projects/[id]/requests/route";
import { POST as resend } from "@/app/api/admin/requests/[id]/send/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { POST as unsubscribeRoute } from "@/app/api/unsubscribe/[token]/route";
import { outboxDir } from "@/lib/email";
import { runDueJobs } from "@/lib/jobs";
import {
  findRequestByToken,
  getRequest,
  parseRecipients,
  parseReminderDays,
  queueDueReminders,
  requestToken,
  unsubscribeToken,
} from "@/lib/requests";
import { createProject, getProjectById, getTestimonial } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminCookie, params, submissionForm, submitRequest, useTempDataDir } from "./helpers";

/** Every message the local SMTP server receives. */
const inbox: { to: string; raw: string }[] = [];
let smtp: SMTPServer;
let smtpUrl = "";

beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
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
  smtpUrl = `smtp://127.0.0.1:${(smtp.server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  inbox.length = 0;
  process.env.SMTP_URL = smtpUrl;
  process.env.SMTP_FROM = "Acme <hello@acme.example>";
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  for (const k of ["SMTP_URL", "SMTP_FROM", "MAIL_OUTBOX"]) delete process.env[k];
  ctx.cleanup();
});

const admin = (url: string, init: RequestInit = {}) =>
  new Request(`http://localhost${url}`, { ...init, headers: { cookie: adminCookie(), "content-type": "application/json" } });

async function ask(recipients: string, send = true) {
  const res = await createRoute(
    admin(`/api/admin/projects/${projectId}/requests`, { method: "POST", body: JSON.stringify({ recipients, send }) }),
    params({ id: projectId }),
  );
  return { status: res.status, body: await res.json() };
}

describe("parsing recipients", () => {
  it("reads pasted lines, bare addresses and CSV with a header", () => {
    expect(parseRecipients("Ada Lovelace, ADA@example.com, Engines Ltd\ngrace@example.com\nnot an email")).toEqual({
      valid: [
        { name: "Ada Lovelace", email: "ada@example.com", company: "Engines Ltd" },
        { name: undefined, email: "grace@example.com", company: undefined },
      ],
      invalid: ["not an email"],
    });
    expect(parseRecipients('Company;Email Address;Full Name\n"Navy; Labs";grace@example.com;Grace Hopper\n').valid).toEqual([
      { name: "Grace Hopper", email: "grace@example.com", company: "Navy; Labs" },
    ]);
  });

  it("reads reminder schedules", () => {
    expect(parseReminderDays("7, 3")).toEqual([3, 7]);
    expect(parseReminderDays("1,2,3,4,0,-1,999")).toEqual([1, 2, 3]);
    expect(parseReminderDays("")).toEqual([]);
  });
});

describe("requests", () => {
  it("emails a personal link through SMTP, with one-click unsubscribe headers", async () => {
    const { status, body } = await ask("Ada Lovelace, ada@example.com, Engines Ltd");
    expect(status).toBe(201);
    const [created] = body.created;
    expect(created).toMatchObject({ email: "ada@example.com", emailStatus: "queued", status: "waiting" });
    expect(created.link).toBe(`http://localhost:3000/c/acme?r=${requestToken(created.id)}`);

    await runDueJobs();
    expect(inbox).toHaveLength(1);
    const mail = await simpleParser(inbox[0].raw);
    expect(inbox[0].to).toBe("ada@example.com");
    expect(mail.from).toBe("Acme <hello@acme.example>");
    expect(mail.subject).toBe("Would you share a few words about Acme?");
    expect(mail.text).toContain("Hi Ada,");
    expect(mail.text).toContain(created.link);
    expect(mail.text).toContain(`/u/${unsubscribeToken(created.id)}`);
    expect(mail.headers["list-unsubscribe"]).toBe(`<http://localhost:3000/api/unsubscribe/${unsubscribeToken(created.id)}>`);
    expect(mail.headers["list-unsubscribe-post"]).toBe("List-Unsubscribe=One-Click");

    const r = getRequest(created.id)!;
    expect(r.emailStatus).toBe("sent");
    expect(r.nextReminderAt!.getTime() - r.sentAt!.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("uses the owner's wording and keeps the link even if the template drops it", async () => {
    await patchProject(
      admin(`/api/admin/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ inviteSubject: "Quick favour, {name}?", inviteMessage: "Hello {name} from {project}!", reminderDays: "" }),
      }),
      params({ id: projectId }),
    );
    const { body } = await ask("Grace Hopper, grace@example.com");
    await runDueJobs();
    const mail = await simpleParser(inbox[0].raw);
    expect(mail.subject).toBe("Quick favour, Grace?");
    expect(mail.text).toMatch(/^Hello Grace from Acme!\n\nhttp:\/\/localhost:3000\/c\/acme\?r=/);
    expect(getRequest(body.created[0].id)!.nextReminderAt).toBeNull();
  });

  it("sends reminders on schedule and stops when the person responds", async () => {
    const { body } = await ask("ada@example.com");
    const id = body.created[0].id;
    await runDueJobs();
    const sentAt = getRequest(id)!.sentAt!.getTime();
    const day = 24 * 60 * 60 * 1000;

    expect(queueDueReminders(new Date(sentAt + 2 * day))).toBe(0);
    expect(queueDueReminders(new Date(sentAt + 3 * day))).toBe(1);
    expect(queueDueReminders(new Date(sentAt + 3 * day))).toBe(0); // not queued twice
    await runDueJobs();
    expect(inbox).toHaveLength(2);
    expect((await simpleParser(inbox[1].raw)).subject).toBe("Reminder: Would you share a few words about Acme?");
    expect(getRequest(id)).toMatchObject({ remindersSent: 1, emailStatus: "sent" });
    expect(getRequest(id)!.nextReminderAt!.getTime()).toBe(sentAt + 7 * day);

    // The person responds through their link.
    const form = submissionForm({ name: "Ada", text: "Lovely", consent: "on", requestToken: requestToken(id) });
    const res = await submit(submitRequest("acme", form), params({ slug: "acme" }));
    const { id: testimonialId } = await res.json();
    expect(getTestimonial(testimonialId)!.requestId).toBe(id);
    expect(getRequest(id)).toMatchObject({ status: "responded", testimonialId, nextReminderAt: null });
    expect(queueDueReminders(new Date(sentAt + 30 * day))).toBe(0);
  });

  it("one-click unsubscribe stops reminders and blocks asking again", async () => {
    const { body } = await ask("ada@example.com");
    const id = body.created[0].id;
    await runDueJobs();
    const token = unsubscribeToken(id);
    const res = await unsubscribeRoute(
      new Request(`http://localhost/api/unsubscribe/${token}`, { method: "POST", body: "List-Unsubscribe=One-Click" }),
      params({ token }),
    );
    expect(res.status).toBe(200);
    expect(getRequest(id)).toMatchObject({ status: "unsubscribed", nextReminderAt: null });
    expect(queueDueReminders(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))).toBe(0);

    const again = await ask("ada@example.com");
    expect(again.body.created).toEqual([]);
    expect(again.body.skipped).toEqual([{ email: "ada@example.com", reason: "unsubscribed" }]);
    const resent = await resend(admin(`/api/admin/requests/${id}/send`, { method: "POST" }), params({ id }));
    expect(resent.status).toBe(409);
  });

  it("skips people who already have an open request, and reports bad rows", async () => {
    await ask("ada@example.com", false);
    const { body } = await ask("ada@example.com\nbob@example.com\nbob@example.com\nnope", false);
    expect(body.created.map((r: { email: string }) => r.email)).toEqual(["bob@example.com"]);
    expect(body.skipped).toEqual([
      { email: "ada@example.com", reason: "duplicate" },
      { email: "bob@example.com", reason: "duplicate" },
    ]);
    expect(body.invalid).toEqual(["nope"]);
    const list = await (await listRoute(admin(`/api/admin/projects/${projectId}/requests`), params({ id: projectId }))).json();
    expect(list.requests).toHaveLength(2);
    expect(list.requests.every((r: { emailStatus: string }) => r.emailStatus === "not_sent")).toBe(true);
  });

  it("works without email: links only, and sending is refused clearly", async () => {
    delete process.env.SMTP_URL;
    const linksOnly = await ask("ada@example.com", false);
    expect(linksOnly.status).toBe(201);
    const refused = await ask("bob@example.com", true);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/SMTP_URL/);
  });

  it("rejects tampered or foreign links", async () => {
    const { body } = await ask("ada@example.com", false);
    const good = requestToken(body.created[0].id);
    expect(findRequestByToken(good)?.id).toBe(body.created[0].id);
    expect(findRequestByToken(good.slice(0, -1) + (good.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(findRequestByToken(`${body.created[0].id}.`)).toBeNull();
    expect(findRequestByToken("garbage")).toBeNull();

    // A link for another project's form is ignored (the submission still counts).
    createProject({ name: "Other", slug: "other" });
    const form = submissionForm({ name: "Ada", text: "Hi", consent: "on", requestToken: good });
    const res = await submit(submitRequest("other", form), params({ slug: "other" }));
    expect(res.status).toBe(201);
    expect(getTestimonial((await res.json()).id)!.requestId).toBeNull();
    expect(getRequest(body.created[0].id)!.status).toBe("waiting");
  });

  it("emails a receipt with the withdrawal link, unless the owner turned it off", async () => {
    const res = await submit(
      submitRequest("acme", submissionForm({ name: "Ada", email: "ada@example.com", text: "Hi", consent: "on" })),
      params({ slug: "acme" }),
    );
    const { withdrawUrl } = await res.json();
    await runDueJobs();
    expect(inbox).toHaveLength(1);
    const mail = await simpleParser(inbox[0].raw);
    expect(mail.subject).toBe("Thanks for your testimonial for Acme");
    expect(mail.text).toContain(withdrawUrl);

    await patchProject(
      admin(`/api/admin/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ thankYouEmail: false }) }),
      params({ id: projectId }),
    );
    expect(getProjectById(projectId)!.thankYouEmail).toBe(false);
    await submit(
      submitRequest("acme", submissionForm({ name: "Bo", email: "bo@example.com", text: "Hi", consent: "on" })),
      params({ slug: "acme" }),
    );
    await runDueJobs();
    expect(inbox).toHaveLength(1);
  });

  it("writes .eml files instead of sending in outbox mode", async () => {
    delete process.env.SMTP_URL;
    process.env.MAIL_OUTBOX = "true";
    await ask("ada@example.com");
    await runDueJobs();
    const files = fs.readdirSync(outboxDir());
    expect(files).toHaveLength(1);
    const mail = await simpleParser(fs.readFileSync(`${outboxDir()}/${files[0]}`, "utf8"));
    expect(mail.subject).toBe("Would you share a few words about Acme?");
  });

  it("marks a request failed after the SMTP server keeps refusing", async () => {
    process.env.SMTP_URL = "smtp://127.0.0.1:1"; // nothing listens here
    const { body } = await ask("ada@example.com");
    const id = body.created[0].id;
    for (let i = 0; i < 4; i++) await runDueJobs({ now: () => new Date(Date.now() + (i + 1) * 7 * 60 * 60 * 1000) });
    expect(getRequest(id)).toMatchObject({ emailStatus: "failed", emailError: expect.stringMatching(/ECONNREFUSED|connect/i) });
  });
});
