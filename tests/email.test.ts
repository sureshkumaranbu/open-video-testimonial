import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createRequests } from "@/app/api/admin/projects/[id]/requests/route";
import { POST as testEmail } from "@/app/api/admin/email/test/route";
import { emailMode, explainSmtpError, fromWarning, isPermanentSmtpError, sendMail } from "@/lib/email";
import { runDueJobs } from "@/lib/jobs";
import { resetRateLimits } from "@/lib/rate-limit";
import { getRequest } from "@/lib/requests";
import { createProject } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { simpleParser } from "./mail-parse";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

/** A mail server that wants a login (with an awkward password) and refuses some senders. */
const USER = "ada@acme.example";
const PASS = "p@ss:w/rd%20#1";
const inbox: { from: string; to: string; raw: string }[] = [];
let smtp: SMTPServer;
let port = 0;

const smtpError = (message: string, responseCode: number) => Object.assign(new Error(message), { responseCode });

beforeAll(async () => {
  smtp = new SMTPServer({
    disabledCommands: ["STARTTLS"],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username === USER && auth.password === PASS) return cb(null, { user: USER });
      cb(smtpError("Authentication credentials invalid", 535));
    },
    onMailFrom(address, _session, cb) {
      if (address.address.endsWith("@not-mine.example")) return cb(smtpError("5.7.1 Sender address rejected: not owned by user", 553));
      cb();
    },
    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        inbox.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address).join(","),
          raw: Buffer.concat(chunks).toString(),
        });
        done();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  port = (smtp.server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

const SMTP_VARS = ["SMTP_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_SECURE", "SMTP_FROM", "MAIL_OUTBOX"];
const goodUrl = () => `smtp://${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@127.0.0.1:${port}`;

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  resetRateLimits();
  inbox.length = 0;
  process.env.SMTP_URL = goodUrl();
  process.env.SMTP_FROM = "Acme <hello@acme.example>";
});
afterEach(() => {
  for (const k of SMTP_VARS) delete process.env[k];
  ctx.cleanup();
});

function sendTest(body: unknown = {}, headers: Record<string, string> = adminHeaders()) {
  return testEmail(
    new Request("http://localhost/api/admin/email/test", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { ...headers, "content-type": "application/json" },
    }),
  );
}

describe("Send test email", () => {
  it("sends to the owner's address by default, or to one they type", async () => {
    const res = await sendTest();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, to: ADMIN_EMAIL, mode: "smtp" });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ from: "hello@acme.example", to: ADMIN_EMAIL });
    const mail = await simpleParser(inbox[0].raw);
    expect(mail.subject).toBe("Plaudit test email");
    expect(mail.text).toContain("sent as Acme <hello@acme.example>");

    expect((await sendTest({ to: "grace@example.com" })).status).toBe(200);
    expect(inbox[1].to).toBe("grace@example.com");
    expect((await sendTest({ to: "not an address" })).status).toBe(400);
  });

  it("is for the signed-in owner only, from the dashboard itself", async () => {
    expect((await sendTest({}, {})).status).toBe(401);
    const crossSite = await sendTest({}, { ...adminHeaders(), "sec-fetch-site": "cross-site", origin: "https://evil.example" });
    expect(crossSite.status).toBe(403);
    expect(inbox).toHaveLength(0);
  });

  it("is rate limited", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await sendTest()).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });

  it("says clearly when email isn't set up", async () => {
    delete process.env.SMTP_URL;
    const res = await sendTest();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/SMTP_URL/);
  });

  it("reports the server's exact words and a hint for a wrong password", async () => {
    process.env.SMTP_URL = `smtp://${encodeURIComponent(USER)}:wrong@127.0.0.1:${port}`;
    const res = await sendTest();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ code: "EAUTH", responseCode: 535 });
    expect(body.error).toContain("535 Authentication credentials invalid");
    expect(body.hint).toMatch(/app password/);
  });

  it("…for a server that isn't there", async () => {
    process.env.SMTP_URL = "smtp://127.0.0.1:1";
    const body = await (await sendTest()).json();
    expect(body.error).toMatch(/ECONNREFUSED/);
    expect(body.hint).toMatch(/Couldn't reach the mail server.*block outgoing mail ports/);
  });

  it("…for a sender the server won't send from", async () => {
    process.env.SMTP_FROM = "someone@not-mine.example";
    const body = await (await sendTest()).json();
    expect(body.error).toMatch(/553/);
    expect(body.hint).toMatch(/won't send from SMTP_FROM/);
  });

  it("…for smtps:// on a port that expects smtp://", async () => {
    process.env.SMTP_URL = goodUrl().replace("smtp://", "smtps://");
    const body = await (await sendTest()).json();
    expect(body.hint).toMatch(/TLS setting doesn't match the port/);
  });

  it("works in outbox mode", async () => {
    delete process.env.SMTP_URL;
    process.env.MAIL_OUTBOX = "true";
    expect(await (await sendTest()).json()).toMatchObject({ ok: true, mode: "outbox" });
  });
});

describe("mail settings", () => {
  it("accepts SMTP_HOST, SMTP_USER and SMTP_PASSWORD, so the password needn't be URL-encoded", async () => {
    delete process.env.SMTP_URL;
    Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_USER: USER, SMTP_PASSWORD: PASS });
    expect(emailMode()).toBe("smtp");
    await sendMail({ to: "ada@example.com", subject: "Hi", text: "Hello" });
    expect(inbox).toHaveLength(1);
  });

  it("SMTP_URL wins when both are set", async () => {
    Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: "1" });
    await sendMail({ to: "ada@example.com", subject: "Hi", text: "Hello" });
    expect(inbox).toHaveLength(1);
  });

  it("warns when SMTP_FROM is missing, as mail would come from no-reply@localhost", () => {
    expect(fromWarning()).toBeNull();
    delete process.env.SMTP_FROM;
    expect(fromWarning()).toMatch(/SMTP_FROM isn't set.*no-reply@localhost/);
    delete process.env.SMTP_URL;
    process.env.MAIL_OUTBOX = "true";
    expect(fromWarning()).toBeNull(); // test mode doesn't send anything
  });
});

describe("SMTP errors", () => {
  const err = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

  it("gives a hint for each common mistake", () => {
    expect(explainSmtpError(err("Invalid login: 535-5.7.8 Username and Password not accepted", { code: "EAUTH", responseCode: 535 }))).toMatch(/app password/);
    expect(explainSmtpError(err("connect ETIMEDOUT 203.0.113.5:465", { code: "ETIMEDOUT" }))).toMatch(/Couldn't reach/);
    expect(explainSmtpError(err("Greeting never received", { code: "ETIMEDOUT" }))).toMatch(/Port 465 needs smtps:\/\//);
    expect(explainSmtpError(err("140343:error:0A00010B:SSL routines:ssl3_get_record:wrong version number", { code: "ESOCKET" }))).toMatch(/TLS setting/);
    expect(explainSmtpError(err("self-signed certificate in certificate chain", { code: "ESOCKET" }))).toMatch(/certificate wasn't accepted/);
    expect(explainSmtpError(err("getaddrinfo ENOTFOUND smtp.gmial.com", { code: "EDNS" }))).toMatch(/doesn't exist/);
    expect(explainSmtpError(err("Mail command failed: 550 5.7.60 SMTP; Client does not have permissions to send as this sender", { code: "EENVELOPE", responseCode: 550 }))).toMatch(/SMTP_FROM/);
    expect(explainSmtpError(err("Can't send mail - all recipients were rejected: 554 Message rejected: Email address is not verified", { code: "EENVELOPE", responseCode: 554 }))).toMatch(/recipient address/);
    expect(explainSmtpError(err("Something else entirely"))).toBeNull();
  });

  it("treats refused logins and 5xx as permanent, connection trouble and 4xx as worth retrying", () => {
    expect(isPermanentSmtpError(err("Invalid login", { code: "EAUTH", responseCode: 535 }))).toBe(true);
    expect(isPermanentSmtpError(err("Mail command failed", { code: "EENVELOPE", responseCode: 553 }))).toBe(true);
    expect(isPermanentSmtpError(err("Temporary auth failure", { code: "EAUTH", responseCode: 454 }))).toBe(false);
    expect(isPermanentSmtpError(err("Greylisted", { code: "EENVELOPE", responseCode: 451 }))).toBe(false);
    expect(isPermanentSmtpError(err("connect ECONNREFUSED", { code: "ESOCKET" }))).toBe(false);
  });
});

describe("request emails", () => {
  async function invite() {
    const project = createProject({ name: "Acme", slug: "acme" });
    const res = await createRequests(
      new Request(`http://localhost/api/admin/projects/${project.id}/requests`, {
        method: "POST",
        body: JSON.stringify({ recipients: "ada@example.com", send: true }),
        headers: { ...adminHeaders(), "content-type": "application/json" },
      }),
      params({ id: project.id }),
    );
    return (await res.json()).created[0].id as string;
  }

  it("fail at once when the server refuses the login, instead of retrying for minutes", async () => {
    process.env.SMTP_URL = `smtp://${encodeURIComponent(USER)}:wrong@127.0.0.1:${port}`;
    const id = await invite();
    await runDueJobs();
    expect(getRequest(id)).toMatchObject({ emailStatus: "failed", emailError: expect.stringMatching(/535/) });
  });

  it("stay queued with the error while a connection problem is retried", async () => {
    process.env.SMTP_URL = "smtp://127.0.0.1:1";
    const id = await invite();
    await runDueJobs();
    expect(getRequest(id)).toMatchObject({ emailStatus: "queued", emailError: expect.stringMatching(/ECONNREFUSED/) });
  });
});
