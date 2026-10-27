import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getCampaignRoute, PATCH as patchCampaign } from "@/app/api/admin/campaigns/[id]/route";
import { POST as previewRoute } from "@/app/api/admin/campaigns/[id]/preview/route";
import { POST as addRoute } from "@/app/api/admin/campaigns/[id]/recipients/route";
import { POST as testRoute } from "@/app/api/admin/campaigns/[id]/test/route";
import { POST as webhookRoute } from "@/app/api/admin/campaigns/[id]/webhook/route";
import { GET as listRequestsRoute } from "@/app/api/admin/projects/[id]/requests/route";
import { POST as createCampaignRoute } from "@/app/api/admin/projects/[id]/campaigns/route";
import { POST as declineRoute } from "@/app/api/decline/[token]/route";
import { POST as hookRoute } from "@/app/api/hooks/campaigns/[token]/route";
import { GET as openRoute } from "@/app/api/open/[token]/route";
import { POST as unsubscribeRoute } from "@/app/api/unsubscribe/[token]/route";
import { POST as invitesRoute } from "@/app/api/v1/invites/route";
import { GET as clickRoute } from "@/app/r/[token]/route";
import crypto from "node:crypto";
import { getDb, schema } from "@/db";
import type { WEBHOOK_EVENTS } from "@/db/schema";
import { createApiKey } from "@/lib/api-keys";
import { fillVariables } from "@/lib/campaign-email";
import { getCampaign, parseRecipientTable } from "@/lib/campaigns";
import { runnerProps } from "@/lib/forms/runner";
import { getDefaultForm } from "@/lib/forms";
import { runDueJobs } from "@/lib/jobs";
import { resetRateLimits } from "@/lib/rate-limit";
import {
  createRequests,
  declineToken,
  getRequest,
  openToken,
  queueDueReminders,
  requestToken,
  unsubscribeToken,
} from "@/lib/requests";
import { checkSenderDomain } from "@/lib/sender-auth";
import { createProject, createTestimonial, getProjectById } from "@/lib/testimonials";
import { createWebhook } from "@/lib/webhook-admin";
import { registerJobs } from "@/lib/worker";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";
import { simpleParser } from "./mail-parse";

const DAY = 24 * 60 * 60 * 1000;

/** Every message the local SMTP server accepts; it refuses bounce@ like a real server refuses an unknown mailbox. */
const inbox: { to: string; raw: string }[] = [];
let smtp: SMTPServer;
let smtpUrl = "";

beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onRcptTo(address, _session, done) {
      if (address.address.startsWith("bounce@")) return done(Object.assign(new Error("5.1.1 No such user here"), { responseCode: 550 }));
      done();
    },
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
  resetRateLimits();
  inbox.length = 0;
  process.env.SMTP_URL = smtpUrl;
  process.env.SMTP_FROM = "Acme <hello@acme.example>";
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  for (const k of ["SMTP_URL", "SMTP_FROM", "MAIL_OUTBOX"]) delete process.env[k];
  ctx.cleanup();
});

const admin = (url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...adminHeaders(), "content-type": "application/json" },
  });

async function json<T = Record<string, any>>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> {
  const r = await res;
  return { status: r.status, body: (await r.json()) as T };
}

async function newCampaign(name = "Spring", extra: object = {}) {
  const { body } = await json(createCampaignRoute(admin(`/api/admin/projects/${projectId}/campaigns`, { name }), params({ id: projectId })));
  const id = body.campaign.id as string;
  if (Object.keys(extra).length) await patchCampaign(admin(`/api/admin/campaigns/${id}`, extra, "PATCH"), params({ id }));
  return id;
}

const add = (id: string, payload: object) => json(addRoute(admin(`/api/admin/campaigns/${id}/recipients`, payload), params({ id })));
const start = (id: string) => json(patchCampaign(admin(`/api/admin/campaigns/${id}`, { status: "active" }, "PATCH"), params({ id })));
const recipients = (id: string) => getDb().select().from(schema.requests).all().filter((r) => r.campaignId === id);

/** The text and HTML parts of a multipart/alternative message. */
async function parts(raw: string) {
  const mail = await simpleParser(raw);
  const boundary = /boundary="?([^";]+)"?/i.exec(mail.headers["content-type"] ?? "")?.[1];
  const out = { text: "", html: "" };
  for (const chunk of boundary ? raw.split(`--${boundary}`).slice(1, -1) : []) {
    const part = await simpleParser(chunk.replace(/^\r?\n/, ""));
    out[/text\/html/i.test(part.headers["content-type"] ?? "") ? "html" : "text"] = part.text.trimEnd();
  }
  return { ...mail, ...out, text: out.text || mail.text };
}

describe("campaign templates", () => {
  it("REQ-01 fills {{name}}, {{first_name}}, {{company}}, {{link}} and custom variables, and the single-brace style", () => {
    const values = { name: "Ada Lovelace", first_name: "Ada", company: "Engines", link: "https://x/r/1", plan: "{link}" };
    expect(fillVariables("Hi {{first_name}} ({{ name }}) at {{company}} on {{plan}}: {{link}} {{unknown}}", values)).toBe(
      "Hi Ada (Ada Lovelace) at Engines on {link}: https://x/r/1 {{unknown}}",
    );
    // {name} keeps the Requests tab's meaning: the first name.
    expect(fillVariables("Hi {name}, {link} {nope}", values)).toBe("Hi Ada, https://x/r/1 {nope}");
  });
});

describe("campaigns", () => {
  it("REQ-01 a campaign starts as a draft with our wording; custom reminder days, sender, reply-to, button and RTL are saved", async () => {
    const id = await newCampaign();
    const c = getCampaign(id)!;
    expect(c).toMatchObject({ status: "draft", trackOpens: false, reminders: "[3,7]" });
    expect(c.subject).toContain("{{first_name}}");
    const { status, body } = await json(
      patchCampaign(
        admin(`/api/admin/campaigns/${id}`, { reminders: [10, 2, 5, 5], senderName: "Ada at Acme", replyTo: "ada@acme.example", buttonText: "Record it", rtl: true }, "PATCH"),
        params({ id }),
      ),
    );
    expect(status).toBe(200);
    expect(body.campaign).toMatchObject({ reminders: [2, 5, 10], senderName: "Ada at Acme", rtl: true, webhook: { on: false } });
    expect(body.campaign).not.toHaveProperty("webhookTokenHash");
    const bad = await json(patchCampaign(admin(`/api/admin/campaigns/${id}`, { reminders: [1, 2, 3, 4] }, "PATCH"), params({ id })));
    expect(bad.status).toBe(400);
  });

  it("REQ-01 sends nothing while a draft, then the campaign's own wording and schedule once started", async () => {
    const id = await newCampaign("Spring", {
      subject: "{{first_name}}, a favour for {{project}}?",
      body: "Hello {{name}} from {{company}} on the {{plan}} plan.\n\n{{link}}\n\nThanks!",
      senderName: "Ada at Acme",
      replyTo: "ada@acme.example",
      buttonText: "Share yours",
      reminders: [2, 9],
    });
    await add(id, { source: "paste", text: "email,name,company,plan\ngrace@example.com,Grace Hopper,Navy,Pro\n" });
    await runDueJobs();
    expect(inbox).toHaveLength(0);
    const [r] = recipients(id);
    expect(r).toMatchObject({ emailStatus: "not_sent", custom: JSON.stringify({ plan: "Pro" }) });

    expect((await start(id)).status).toBe(200);
    await runDueJobs();
    expect(inbox).toHaveLength(1);
    const mail = await parts(inbox[0].raw);
    expect(mail.from).toBe("Ada at Acme <hello@acme.example>");
    expect(mail.headers["reply-to"]).toBe("ada@acme.example");
    expect(mail.subject).toBe("Grace, a favour for Acme?");
    expect(mail.text).toContain("Hello Grace Hopper from Navy on the Pro plan.");
    expect(mail.text).toContain(`http://localhost:3000/r/${requestToken(r.id)}`);
    expect(mail.html).toContain(">Share yours</a>");
    const sent = getRequest(r.id)!;
    expect(sent.nextReminderAt!.getTime() - sent.sentAt!.getTime()).toBe(2 * DAY);

    // Reminders follow the campaign's days, not the project's.
    queueDueReminders(new Date(Date.now() + 2 * DAY + 1000));
    await runDueJobs({ now: () => new Date(Date.now() + 2 * DAY + 2000) });
    expect(inbox).toHaveLength(2);
    expect((await simpleParser(inbox[1].raw)).subject).toBe("Reminder: Grace, a favour for Acme?");
    expect(getRequest(r.id)!.nextReminderAt!.getTime() - sent.sentAt!.getTime()).toBe(9 * DAY);
  });

  it("REQ-01 pausing holds invitations and reminders; resuming sends them", async () => {
    const id = await newCampaign();
    await start(id);
    await json(patchCampaign(admin(`/api/admin/campaigns/${id}`, { status: "paused" }, "PATCH"), params({ id })));
    await add(id, { source: "manual", person: { email: "lin@example.com", name: "Lin" } });
    await runDueJobs();
    expect(inbox).toHaveLength(0);
    expect(recipients(id)[0].emailStatus).toBe("not_sent");
    await start(id);
    await runDueJobs();
    expect(inbox).toHaveLength(1);
  });

  it("REQ-01 the list shows each campaign's numbers; the Requests tab keeps only its own requests", async () => {
    const id = await newCampaign();
    await add(id, { source: "paste", text: "a@example.com\nb@example.com" });
    createRequests(getProjectById(projectId)!, [{ email: "old@example.com" }], { send: false });
    const { body } = await json(getCampaignRoute(admin(`/api/admin/campaigns/${id}`), params({ id })));
    expect(body.campaign.funnel).toMatchObject({ recipients: 2, sent: 0, submitted: 0, opened: null });
    const tab = await json(listRequestsRoute(admin(`/api/admin/projects/${projectId}/requests`), params({ id: projectId })));
    expect(tab.body.requests.map((r: { email: string }) => r.email)).toEqual(["old@example.com"]);
  });
});

describe("recipients", () => {
  it("REQ-02 reads a CSV with name, email, company, title and custom columns, or first and last names", () => {
    const rows = parseRecipientTable("First name,Last name,Email,Company,Job title,Plan name\nAda,Lovelace,ADA@example.com,Engines,CTO,Pro\nBob,,not-an-email,,,\n");
    expect(rows[0]).toMatchObject({ line: 2, input: { email: "ada@example.com", name: "Ada Lovelace", company: "Engines", title: "CTO", custom: { plan_name: "Pro" } } });
    expect(rows[1]).toMatchObject({ line: 3, error: "Not a valid email address" });
    expect(parseRecipientTable("Grace Hopper, grace@example.com, Navy\nlin@example.com").map((r) => r.input?.email)).toEqual(["grace@example.com", "lin@example.com"]);
  });

  it("REQ-02 dedupes within the campaign, skips unsubscribed and already-responded people, and reports every skipped row", async () => {
    const project = getProjectById(projectId)!;
    // Unsubscribed through an old request: project-wide, by email.
    const [old] = createRequests(project, [{ email: "gone@example.com" }], { send: false }).created;
    await unsubscribeRoute(new Request("http://localhost/x", { method: "POST" }), params({ token: unsubscribeToken(old.id) }));
    createTestimonial(projectId, { name: "Tess", email: "Tess@Example.com", text: "Great" });
    const id = await newCampaign();
    await add(id, { source: "manual", person: { email: "dup@example.com" } });
    const { status, body } = await add(id, {
      source: "paste",
      text: "email,name\nnew@example.com,New\ndup@example.com,Dup\ngone@example.com,Gone\ntess@example.com,Tess\nnope,Nope\nnew@example.com,Again\n",
    });
    expect(status).toBe(201);
    expect(body.added.map((r: { email: string }) => r.email)).toEqual(["new@example.com"]);
    expect(body.skipped.map((s: { line: number; reason: string }) => [s.line, s.reason])).toEqual([
      [3, "duplicate"],
      [4, "unsubscribed"],
      [5, "responded"],
      [6, "invalid"],
      [7, "duplicate"],
    ]);
  });

  it("REQ-02 picks people from the project's customers", async () => {
    const customer = (email: string, name: string, company: string) => {
      const id = crypto.randomUUID();
      getDb().insert(schema.customers).values({ id, projectId, email, name, company, createdAt: new Date(), updatedAt: new Date() }).run();
      return id;
    };
    const cy = customer("cy@example.com", "Cy Customer", "Cyco");
    const dee = customer("dee@example.com", "Dee", "Deeco");
    createTestimonial(projectId, { name: "Cy Customer", email: "cy@example.com", text: "Nice" });
    const id = await newCampaign();
    const { body } = await json(getCampaignRoute(admin(`/api/admin/campaigns/${id}`), params({ id })));
    expect(body.customers.map((c: { email: string }) => c.email)).toEqual(["cy@example.com", "dee@example.com"]);
    // Cy already sent a testimonial, so picking Cy is reported as already responded.
    const picked = await add(id, { source: "customers", ids: [cy, dee] });
    expect(picked.body.skipped).toEqual([expect.objectContaining({ reason: "responded", email: "cy@example.com" })]);
    expect(picked.body.added[0]).toMatchObject({ email: "dee@example.com", name: "Dee", company: "Deeco" });
  });
});

describe("preview and test send", () => {
  it("REQ-03 the preview is the sent mail: same subject, text and HTML (only the open pixel is left out)", async () => {
    const id = await newCampaign("Spring", { body: "Hi {{first_name}},\n\n{{link}}\n\nThanks", trackOpens: true });
    await add(id, { source: "manual", person: { email: "ada@example.com", name: "Ada Lovelace" } });
    const [r] = recipients(id);
    const { body } = await json(previewRoute(admin(`/api/admin/campaigns/${id}/preview`, { recipientId: r.id }), params({ id })));
    await start(id);
    await runDueJobs();
    const mail = await parts(inbox[0].raw);
    expect(mail.subject).toBe(body.preview.subject);
    expect(mail.text).toBe(body.preview.text.trimEnd());
    const pixel = `<img src="http://localhost:3000/api/open/${openToken(r.id)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`;
    expect(mail.html).toContain(pixel);
    expect(mail.html.replace(`\n${pixel}`, "")).toBe(body.preview.html.trimEnd());
    expect(body.preview.html).not.toContain("/api/open/");
  });

  it("REQ-03 previews unsaved wording with a sample person", async () => {
    const id = await newCampaign();
    const { body } = await json(previewRoute(admin(`/api/admin/campaigns/${id}/preview`, { subject: "Draft for {{first_name}}", rtl: true }), params({ id })));
    expect(body.preview.subject).toBe("Draft for Sam");
    expect(body.preview.html).toContain('dir="rtl"');
    expect(body.preview.text).toContain("http://localhost:3000/c/acme");
  });

  it("REQ-06 'Send a test to me' goes to the signed-in member and reports the From domain's SPF and DMARC", async () => {
    const id = await newCampaign();
    const { status, body } = await json(testRoute(admin(`/api/admin/campaigns/${id}/test`, { subject: "Test {{first_name}}" }), params({ id })));
    expect(status).toBe(200);
    expect(body).toMatchObject({ to: ADMIN_EMAIL, subject: "[Test] Test Sam", auth: { domain: "acme.example", checked: false } });
    expect(inbox[0].to).toBe(ADMIN_EMAIL);
    expect(recipients(id)).toHaveLength(0);
  });

  it("REQ-06 reports SPF and DMARC records, missing ones, and a lookup that times out, without throwing", async () => {
    const records: Record<string, string[][]> = {
      "good.org": [["v=spf1 include:_spf.mail.org ~all"], ["google-site-verification=x"]],
      "_dmarc.good.org": [["v=DMARC1; p=none"]],
    };
    const lookup = async (name: string) => {
      if (name.includes("slow")) return new Promise<string[][]>(() => {});
      if (records[name]) return records[name];
      throw Object.assign(new Error("no data"), { code: "ENODATA" });
    };
    expect(await checkSenderDomain("a@good.org", { lookup })).toEqual({
      domain: "good.org",
      checked: true,
      spf: "v=spf1 include:_spf.mail.org ~all",
      dmarc: "v=DMARC1; p=none",
      note: null,
    });
    expect(await checkSenderDomain("a@bare.org", { lookup })).toMatchObject({ checked: true, spf: null, dmarc: null, note: null });
    expect(await checkSenderDomain("a@slow.org", { lookup, timeoutMs: 20 })).toMatchObject({ spf: null, note: "The DNS lookup timed out" });
    expect(await checkSenderDomain("no-reply@localhost")).toMatchObject({ checked: false });
  });
});

describe("tracking", () => {
  async function sentRecipient(extra: object = {}) {
    const id = await newCampaign("Spring", extra);
    await add(id, { source: "manual", person: { email: "ada@example.com", name: "Ada" } });
    await start(id);
    await runDueJobs();
    return { id, r: recipients(id)[0] };
  }

  it("REQ-04 the link records the click and goes to the request's own form link, never anywhere else", async () => {
    const { r } = await sentRecipient();
    const res = await clickRoute(new Request(`http://localhost/r/${requestToken(r.id)}?to=https://evil.example`), params({ token: requestToken(r.id) }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`http://localhost:3000/c/acme?r=${requestToken(r.id)}`);
    const clicked = getRequest(r.id)!;
    expect(clicked.clickedAt).toBeInstanceOf(Date);
    await clickRoute(new Request("http://localhost/r/x"), params({ token: requestToken(r.id) }));
    expect(getRequest(r.id)!.clickedAt).toEqual(clicked.clickedAt);
    expect((await clickRoute(new Request("http://localhost/r/x"), params({ token: `${r.id}.forged` }))).status).toBe(404);
  });

  it("REQ-04 opening the form with the token counts as started; submitting marks it responded", async () => {
    const { r } = await sentRecipient();
    const project = getProjectById(projectId)!;
    runnerProps(project, getDefaultForm(projectId), { r: requestToken(r.id) });
    expect(getRequest(r.id)!.startedAt).toBeInstanceOf(Date);
    const { body } = await json(getCampaignRoute(admin(`/api/admin/campaigns/${r.campaignId}`), params({ id: r.campaignId! })));
    expect(body.recipients[0].stage).toBe("started");
    expect(body.campaign.funnel).toMatchObject({ sent: 1, started: 1 });
  });

  it("REQ-04 the open pixel counts only for a campaign that opted in, and stores a time only", async () => {
    const off = await sentRecipient();
    const res = await openRoute(new Request("http://localhost/x"), params({ token: openToken(off.r.id) }));
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(getRequest(off.r.id)!.openedAt).toBeNull();
    expect((await parts(inbox[0].raw)).html).not.toContain("/api/open/");

    getDb().delete(schema.requests).run();
    inbox.length = 0;
    const on = await sentRecipient({ trackOpens: true });
    expect((await parts(inbox[0].raw)).html).toContain(`/api/open/${openToken(on.r.id)}`);
    await openRoute(new Request("http://localhost/x"), params({ token: openToken(on.r.id) }));
    expect(getRequest(on.r.id)!.openedAt).toBeInstanceOf(Date);
  });

  it("REQ-04 a permanent refusal of the address at send time shows as bounced", async () => {
    const id = await newCampaign();
    await add(id, { source: "manual", person: { email: "bounce@example.com" } });
    await start(id);
    await runDueJobs();
    expect(recipients(id)[0]).toMatchObject({ emailStatus: "bounced", emailError: expect.stringMatching(/No such user/) });
    const { body } = await json(getCampaignRoute(admin(`/api/admin/campaigns/${id}`), params({ id })));
    expect(body.campaign.funnel.bounced).toBe(1);
    expect(body.recipients[0].stage).toBe("bounced");
  });

  it("REQ-04 unsubscribing stops every campaign and request of the project for that address", async () => {
    const a = await newCampaign("A");
    const b = await newCampaign("B");
    await add(a, { source: "manual", person: { email: "ada@example.com" } });
    await add(b, { source: "manual", person: { email: "ada@example.com" } });
    const [ra] = recipients(a);
    await unsubscribeRoute(new Request("http://localhost/x", { method: "POST" }), params({ token: unsubscribeToken(ra.id) }));
    expect(recipients(b)[0].status).toBe("unsubscribed");
    await start(b);
    await runDueJobs();
    expect(inbox).toHaveLength(0);
  });
});

describe("decline", () => {
  it("REQ-05 every campaign email has a No thanks link and RFC 8058 headers; declining stops reminders", async () => {
    const id = await newCampaign();
    await add(id, { source: "manual", person: { email: "ada@example.com", name: "Ada" } });
    await start(id);
    await runDueJobs();
    const [r] = recipients(id);
    const mail = await parts(inbox[0].raw);
    expect(mail.text).toContain(`No thanks? http://localhost:3000/d/${declineToken(r.id)}`);
    expect(mail.html).toContain(`/d/${declineToken(r.id)}`);
    expect(mail.headers["list-unsubscribe"]).toBe(`<http://localhost:3000/api/unsubscribe/${unsubscribeToken(r.id)}>`);
    expect(mail.headers["list-unsubscribe-post"]).toBe("List-Unsubscribe=One-Click");

    const res = await json(declineRoute(new Request("http://localhost/x", { method: "POST" }), params({ token: declineToken(r.id) })));
    expect(res.body).toEqual({ ok: true, status: "declined" });
    expect(getRequest(r.id)).toMatchObject({ status: "declined", nextReminderAt: null });
    expect(queueDueReminders(new Date(Date.now() + 30 * DAY))).toBe(0);
    // An unsubscribe token can't decline, nor the other way round.
    expect((await declineRoute(new Request("http://localhost/x", { method: "POST" }), params({ token: unsubscribeToken(r.id) }))).status).toBe(404);
  });
});

describe("auto-collect", () => {
  const withKey = (key: string, body: unknown) =>
    new Request("http://localhost/api/v1/invites", { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } });

  it("REQ-07 POST /api/v1/invites needs a write key and an active campaign, queues after delayDays, and skips repeats", async () => {
    const read = createApiKey("r", "read").key;
    const write = createApiKey("w", "write").key;
    const id = await newCampaign();
    const payload = { campaignId: id, email: "Zed@Example.com", name: "Zed", variables: { plan: "Pro" }, delayDays: 3 };
    expect((await invitesRoute(withKey(read, payload))).status).toBe(403);
    expect((await json(invitesRoute(withKey(write, payload)))).status).toBe(409); // still a draft
    await start(id);
    expect((await invitesRoute(withKey(write, { ...payload, campaignId: "nope" }))).status).toBe(404);
    expect((await invitesRoute(withKey(write, { ...payload, email: "bad" }))).status).toBe(400);

    const created = await json(invitesRoute(withKey(write, payload)));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ email: "zed@example.com", campaignId: id, stage: "queued", variables: { plan: "Pro" } });
    const scheduled = new Date(created.body.data.scheduledFor).getTime();
    expect(Math.abs(scheduled - (Date.now() + 3 * DAY))).toBeLessThan(5000);
    await runDueJobs();
    expect(inbox).toHaveLength(0);
    await runDueJobs({ now: () => new Date(Date.now() + 3 * DAY + 1000) });
    expect(inbox).toHaveLength(1);

    const again = await json(invitesRoute(withKey(write, payload)));
    expect(again).toMatchObject({ status: 200, body: { skipped: "duplicate", data: { id: created.body.data.id } } });
  });

  it("REQ-07 the incoming webhook takes JSON with variables and a delay, checks its token and input, and can be regenerated", async () => {
    const id = await newCampaign("Hooked", { body: "Hi {{first_name}} on {{plan}}\n\n{{link}}" });
    await start(id);
    const { body } = await json(webhookRoute(admin(`/api/admin/campaigns/${id}/webhook`, {}), params({ id })));
    const token = (body.url as string).split("/").at(-1)!;
    expect(body.url).toMatch(/^http:\/\/localhost:3000\/api\/hooks\/campaigns\/cwh_[\w-]{32}$/);
    expect(getCampaign(id)!.webhookTokenHash).not.toContain(token);
    const hook = (t: string, payload: unknown, o: { query?: string; type?: string } = {}) =>
      hookRoute(
        new Request(`http://localhost/api/hooks/campaigns/${t}${o.query ?? ""}`, {
          method: "POST",
          body: typeof payload === "string" ? payload : JSON.stringify(payload),
          headers: { "content-type": o.type ?? "application/json" },
        }),
        params({ token: t }),
      );

    const ok = await json(hook(token, { email: "kim@example.com", name: "Kim Lee", plan: "Team" }));
    expect(ok.status).toBe(202);
    await runDueJobs();
    expect((await parts(inbox[0].raw)).text).toContain("Hi Kim on Team");

    const later = await json(hook(token, { email: "lou@example.com" }, { query: "?delay=2" }));
    expect(Math.abs(new Date(later.body.scheduledFor).getTime() - (Date.now() + 2 * DAY))).toBeLessThan(5000);
    expect((await json(hook(token, { email: "kim@example.com" }))).body.skipped).toBe("duplicate");
    expect((await hook(token, { email: "not-an-email" })).status).toBe(400);
    expect((await hook(token, "{nope")).status).toBe(400);
    expect((await hook(token, { email: "x@example.com" }, { type: "text/plain" })).status).toBe(415);
    expect((await hook(token, { email: "x@example.com", note: "x".repeat(20_000) })).status).toBe(413);
    expect((await hook("cwh_" + "a".repeat(32), { email: "x@example.com" })).status).toBe(404);

    await webhookRoute(admin(`/api/admin/campaigns/${id}/webhook`, {}), params({ id }));
    expect((await hook(token, { email: "new@example.com" })).status).toBe(404);
  });

  it("REQ-07 the incoming webhook is rate limited", async () => {
    const id = await newCampaign();
    await start(id);
    const { body } = await json(webhookRoute(admin(`/api/admin/campaigns/${id}/webhook`, {}), params({ id })));
    const token = (body.url as string).split("/").at(-1)!;
    let last = 0;
    for (let i = 0; i < 121; i++) {
      last = (
        await hookRoute(
          new Request(`http://localhost/api/hooks/campaigns/${token}`, { method: "POST", body: JSON.stringify({ email: `p${i}@example.com` }), headers: { "content-type": "application/json" } }),
          params({ token }),
        )
      ).status;
    }
    expect(last).toBe(429);
  });
});

describe("invite webhooks", () => {
  it("REQ-04 invite.sent, invite.clicked, invite.opened and invite.declined go only to hooks that tick them", async () => {
    const hook = (url: string, events: (typeof WEBHOOK_EVENTS)[number][]) => createWebhook({ url, events, projectId: null, formId: null, active: true }).id;
    const catchAll = hook("http://127.0.0.1:9/all", []);
    const optIn = hook("http://127.0.0.1:9/inv", ["invite.sent", "invite.opened", "invite.clicked", "invite.declined"]);
    const id = await newCampaign("Spring", { trackOpens: true });
    await add(id, { source: "manual", person: { email: "ada@example.com" } });
    await start(id);
    await runDueJobs({ limit: 1 });
    const [r] = recipients(id);
    await openRoute(new Request("http://localhost/x"), params({ token: openToken(r.id) }));
    await clickRoute(new Request("http://localhost/x"), params({ token: requestToken(r.id) }));
    await declineRoute(new Request("http://localhost/x", { method: "POST" }), params({ token: declineToken(r.id) }));
    const deliveries = getDb().select().from(schema.webhookDeliveries).all();
    expect(deliveries.filter((d) => d.webhookId === catchAll)).toEqual([]);
    const events = deliveries.filter((d) => d.webhookId === optIn).map((d) => d.event);
    expect(events).toEqual(["invite.sent", "invite.opened", "invite.clicked", "invite.declined"]);
    const payload = JSON.parse(deliveries.find((d) => d.event === "invite.sent")!.payload);
    expect(payload.data).toMatchObject({ kind: "invite", invite: { id: r.id, campaignId: id, email: "ada@example.com" } });
  });
});
