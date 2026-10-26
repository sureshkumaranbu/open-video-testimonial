import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listChannelsRoute, POST as createChannelRoute } from "@/app/api/admin/notification-channels/route";
import { PATCH as patchChannelRoute } from "@/app/api/admin/notification-channels/[id]/route";
import { POST as testChannelRoute } from "@/app/api/admin/notification-channels/[id]/test/route";
import { GET as getPrefsRoute, PUT as putPrefsRoute } from "@/app/api/admin/me/notifications/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { getDb, schema } from "@/db";
import { getDefaultForm, updateForm } from "@/lib/forms";
import { parseFormRow } from "@/lib/forms/schema";
import { runDueJobs } from "@/lib/jobs";
import { inviteMember, recordSignIn } from "@/lib/members";
import { dailyBoundary, monthlyBoundary, runDigests, weeklyBoundary } from "@/lib/notifications";
import { validateChannelTarget } from "@/lib/notifications/channels";
import { formatDiscord, formatSlack, formatTeams, formatTelegram, type NotifyMessage } from "@/lib/notifications/format";
import { getPrefs, setPrefs } from "@/lib/notifications/prefs";
import { createProject, createTestimonial, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { emitEvent, emitTestimonialEvent } from "@/lib/webhooks";
import { registerJobs } from "@/lib/worker";
import { simpleParser } from "./mail-parse";
import { ADMIN_EMAIL, adminHeaders, params, submissionForm, submitRequest, useTempDataDir } from "./helpers";

/** A local stand-in for Slack, Discord, Teams and Telegram: records every POST. */
const received: { path: string; body: unknown }[] = [];
let receiver: http.Server;
let origin = "";
let failNext = 0;

beforeAll(async () => {
  receiver = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (failNext > 0) {
        failNext--;
        res.writeHead(404, { "content-type": "text/plain" }).end("no_service");
        return;
      }
      received.push({ path: req.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString() || "null") });
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => receiver.close(() => r())));

const ENV = ["NET_GUARD_ALLOW", "IMPORTER_ORIGINS", "MAIL_OUTBOX", "ADMIN_EMAILS", "PUBLIC_URL", "DIGEST_HOUR_UTC"];
let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  received.length = 0;
  failNext = 0;
  process.env.NET_GUARD_ALLOW = new URL(origin).host;
  process.env.IMPORTER_ORIGINS = `telegram=${origin}/telegram`;
  process.env.MAIL_OUTBOX = "true";
  process.env.PUBLIC_URL = "https://plaudit.example";
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  ctx.cleanup();
});

const json = (url: string, method: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { ...adminHeaders(), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function addChannel(body: object) {
  const res = await createChannelRoute(json("/api/admin/notification-channels", "POST", body));
  return { status: res.status, body: (await res.json()) as { channel: { id: string; target: string }; error?: string } };
}

async function submitText(text = "Saved us hours every week.", rating = "5") {
  const res = await submit(submitRequest("acme", submissionForm({ name: "Ada Lovelace", title: "CTO", company: "Engines", consent: "on", rating, text })), params({ slug: "acme" }));
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as { id: string }).id;
}

function outbox() {
  const dir = path.join(ctx.dir, "mail-outbox");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
}
async function mails() {
  return Promise.all(outbox().map((raw) => simpleParser(raw)));
}

const sample: NotifyMessage = {
  title: "New testimonial for Acme",
  projectName: "Acme",
  author: "Ada <b>@everyone</b>",
  byline: "CTO, Engines",
  rating: 4,
  quote: "Great *product* <script>alert(1)</script> & more",
  url: "https://plaudit.example/admin/projects/p?open=t",
  linkLabel: "Review and approve",
};

describe("chat payloads", () => {
  it("INT-02 formats Slack, Discord, Teams and Telegram messages with escaped text", () => {
    const slack = JSON.stringify(formatSlack(sample));
    expect(slack).toContain("★★★★☆");
    expect(slack).toContain("&lt;script&gt;");
    expect(slack).not.toContain("<script>");
    expect(slack).toContain(sample.url);
    const discord = formatDiscord(sample) as { allowed_mentions: { parse: string[] }; embeds: { description: string; url: string }[] };
    expect(discord.allowed_mentions.parse).toEqual([]);
    expect(discord.embeds[0].description).toContain("\\*product\\*");
    expect(discord.embeds[0].url).toBe(sample.url);
    const teams = JSON.stringify(formatTeams(sample));
    expect(teams).toContain("AdaptiveCard");
    expect(teams).toContain("Action.OpenUrl");
    const tg = formatTelegram(sample) as { text: string; parse_mode: string };
    expect(tg.parse_mode).toBe("HTML");
    expect(tg.text).toContain("&lt;script&gt;");
    expect(tg.text).toContain(`<a href="${sample.url}">`);
  });

  it("INT-02 a new submission posts to all four services with the quote, stars and approve link", async () => {
    await addChannel({ type: "slack", name: "#love", target: `${origin}/slack`, projectId });
    await addChannel({ type: "discord", name: "Discord", target: `${origin}/discord` });
    await addChannel({ type: "teams", name: "Teams", target: `${origin}/teams` });
    await addChannel({ type: "telegram", name: "TG", target: { botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ", chatId: "-100123" } });
    const id = await submitText();
    await runDueJobs();
    const byPath = Object.fromEntries(received.map((r) => [r.path.split("/")[1], r]));
    expect(Object.keys(byPath).sort()).toEqual(["discord", "slack", "teams", "telegram"]);
    for (const r of received) {
      const body = JSON.stringify(r.body);
      expect(body).toContain("Saved us hours every week.");
      expect(body).toContain("★★★★★");
      expect(body).toContain(`https://plaudit.example/admin/projects/${projectId}?open=${id}`);
    }
    expect(byPath.telegram.path).toBe("/telegram/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ/sendMessage");
    expect((byPath.telegram.body as { chat_id: string }).chat_id).toBe("-100123");
  });

  it("INT-02 refuses targets outside each service's hosts, plain http and private addresses", () => {
    expect(validateChannelTarget("slack", "https://hooks.slack.com/services/T0/B0/xyz")).toBeNull();
    expect(validateChannelTarget("slack", "http://hooks.slack.com/services/T0/B0/xyz")).toMatch(/https/);
    expect(validateChannelTarget("slack", "https://hooks.slack.com.evil.example/services/x")).toMatch(/isn't a Slack/);
    expect(validateChannelTarget("slack", "https://169.254.169.254/services/x")).toMatch(/isn't a Slack/);
    expect(validateChannelTarget("discord", "https://discord.com/api/webhooks/123/abc-DEF")).toBeNull();
    expect(validateChannelTarget("discord", "https://discord.com/channels/1/2")).toMatch(/isn't a Discord/);
    expect(validateChannelTarget("teams", "https://prod-01.westus.logic.azure.com/workflows/abc/triggers/manual")).toBeNull();
    expect(validateChannelTarget("teams", "https://acme.webhook.office.com/webhookb2/x")).toBeNull();
    expect(validateChannelTarget("teams", "https://example.com/webhook")).toMatch(/isn't a Microsoft Teams/);
    expect(validateChannelTarget("telegram", JSON.stringify({ botToken: "nope", chatId: "1" }))).toMatch(/bot token/);
    // A private address is allowed only when NET_GUARD_ALLOW names exactly it.
    expect(validateChannelTarget("slack", `${origin}/x`)).toBeNull();
    delete process.env.NET_GUARD_ALLOW;
    expect(validateChannelTarget("slack", `${origin}/x`)).toMatch(/https/);
  });

  it("INT-02 the channel API masks targets and validates updates", async () => {
    const { status, body } = await addChannel({ type: "slack", name: "#love", target: `${origin}/services/T123/B456/secret-token` });
    expect(status).toBe(201);
    expect(body.channel.target).not.toContain("secret-token");
    const list = (await (await listChannelsRoute(json("/api/admin/notification-channels", "GET"))).json()) as { channels: { target: string }[] };
    expect(JSON.stringify(list)).not.toContain("secret-token");
    const bad = await patchChannelRoute(json(`/api/admin/notification-channels/${body.channel.id}`, "PATCH", { target: "https://example.com/x" }), params({ id: body.channel.id }));
    expect(bad.status).toBe(400);
    const refused = await addChannel({ type: "discord", name: "x", target: "https://evil.example/api/webhooks/1/2" });
    expect(refused.status).toBe(400);
  });

  it("INT-02 the Test button sends a sample message and reports a failure", async () => {
    const { body } = await addChannel({ type: "discord", name: "Discord", target: `${origin}/discord` });
    const ok = await testChannelRoute(json(`/api/admin/notification-channels/${body.channel.id}/test`, "POST"), params({ id: body.channel.id }));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(received[0].body)).toContain("This is a test message");
    failNext = 1;
    const fail = await testChannelRoute(json(`/api/admin/notification-channels/${body.channel.id}/test`, "POST"), params({ id: body.channel.id }));
    expect(fail.status).toBe(502);
    const out = (await fail.json()) as { error: string; channel: { lastError: string } };
    expect(out.error).toMatch(/404/);
    expect(out.channel.lastError).toMatch(/404/);
  });

  it("INT-02 per-form channels: a form's choice and a channel's forms both apply", async () => {
    const a = (await addChannel({ type: "slack", name: "A", target: `${origin}/a`, projectId })).body.channel.id;
    await addChannel({ type: "slack", name: "B", target: `${origin}/b`, projectId });
    const form = getDefaultForm(projectId);
    const cfg = parseFormRow(form);
    updateForm(form.id, { settings: { ...cfg.settings, notify: { channelIds: [a] } } });
    await submitText();
    await runDueJobs();
    expect(received.map((r) => r.path)).toEqual(["/a"]);

    received.length = 0;
    updateForm(form.id, { settings: { ...cfg.settings, notify: { channelIds: [] } } });
    await submitText("Second one");
    await runDueJobs();
    expect(received).toEqual([]);

    // A channel limited to another form stays quiet for this one.
    received.length = 0;
    updateForm(form.id, { settings: { ...cfg.settings, notify: { channelIds: "all" } } });
    const other = createProject({ name: "Other", slug: "other" });
    const otherForm = getDefaultForm(other.id);
    await addChannel({ type: "slack", name: "C", target: `${origin}/c`, projectId: other.id, formIds: [otherForm.id] });
    await submitText("Third one");
    await runDueJobs();
    expect(received.map((r) => r.path).sort()).toEqual(["/a", "/b"]);
  });

  it("INT-02 a hook that answers 4xx stops retrying and shows the error", async () => {
    const { body } = await addChannel({ type: "slack", name: "A", target: `${origin}/a` });
    failNext = 1;
    await submitText();
    await runDueJobs();
    const row = getDb().select().from(schema.notificationChannels).all()[0];
    expect(row.lastError).toMatch(/404/);
    const jobs = getDb().select().from(schema.jobs).all().filter((j) => j.type === "notify.channel");
    expect(jobs.every((j) => j.status === "failed")).toBe(true);
    expect(body.channel.id).toBe(row.id);
  });
});

describe("email notifications", () => {
  it("INT-01 prefs are per person, off by default, and only the given fields change", async () => {
    expect(getPrefs(ADMIN_EMAIL)).toMatchObject({ newTestimonial: "off", weeklyPending: false, importSummary: false, monthlyReport: false });
    const get = (await (await getPrefsRoute(json("/api/admin/me/notifications", "GET"))).json()) as { notifications: object };
    expect(get.notifications).toMatchObject({ newTestimonial: "off" });
    await putPrefsRoute(json("/api/admin/me/notifications", "PUT", { notifications: { weeklyPending: true } }));
    await putPrefsRoute(json("/api/admin/me/notifications", "PUT", { notifications: { newTestimonial: "instant" } }));
    expect(getPrefs(ADMIN_EMAIL)).toMatchObject({ newTestimonial: "instant", weeklyPending: true });
    const bad = await putPrefsRoute(json("/api/admin/me/notifications", "PUT", { notifications: { newTestimonial: "hourly" } }));
    expect(bad.status).toBe(400);
    expect(getPrefs("someone@else.example").newTestimonial).toBe("off");
  });

  it("INT-01 instant email goes only to members who have signed in and still have access", async () => {
    process.env.ADMIN_EMAILS = "never@acme.example,gone@acme.example";
    recordSignIn(ADMIN_EMAIL);
    recordSignIn("gone@acme.example");
    for (const e of [ADMIN_EMAIL, "never@acme.example", "gone@acme.example"]) setPrefs(e, { newTestimonial: "instant" });
    // Taken out of ADMIN_EMAILS after signing in: no more mail.
    process.env.ADMIN_EMAILS = "never@acme.example";
    inviteMember("invited@acme.example", ADMIN_EMAIL);
    recordSignIn("invited@acme.example");
    setPrefs("invited@acme.example", { newTestimonial: "instant", projectIds: ["some-other-project"] });
    await submitText();
    await runDueJobs();
    const sent = await mails();
    expect(sent.map((m) => m.headers.to)).toEqual([ADMIN_EMAIL]);
    expect(sent[0].subject).toMatch(/New testimonial for Acme \(5\/5\) from Ada Lovelace/);
    expect(sent[0].text).toContain("Saved us hours every week.");
    expect(sent[0].text).toContain(`https://plaudit.example/admin/projects/${projectId}?open=`);
  });

  it("INT-01 quiet imports and owner manual adds send nothing", async () => {
    recordSignIn(ADMIN_EMAIL);
    setPrefs(ADMIN_EMAIL, { newTestimonial: "instant" });
    await addChannel({ type: "slack", name: "A", target: `${origin}/a` });
    const manual = createTestimonial(projectId, { name: "Bo", text: "Added by hand" }, { source: "manual" });
    emitTestimonialEvent("testimonial.created", getTestimonial(manual.id));
    updateTestimonial(manual.id, { status: "approved" });
    const imported = createTestimonial(projectId, { name: "Cy", text: "From a review site" }, { source: "importer:trustpilot" });
    emitTestimonialEvent("testimonial.created", getTestimonial(imported.id));
    updateTestimonial(imported.id, { status: "approved" }, { quiet: true, as: "import" });
    emitEvent("testimonial.created", getDb().select().from(schema.projects).get()!, {}, { quiet: true });
    await runDueJobs();
    expect(received).toEqual([]);
    expect(outbox()).toEqual([]);
  });

  it("INT-01 the daily digest sends once per day per email", async () => {
    process.env.DIGEST_HOUR_UTC = "8";
    recordSignIn(ADMIN_EMAIL);
    const t0 = new Date("2026-10-20T10:00:00Z");
    setPrefs(ADMIN_EMAIL, { newTestimonial: "daily" });
    getDb().update(schema.memberPrefs).set({ lastDigestAt: t0 }).run();
    const id1 = createTestimonial(projectId, { name: "Ada", text: "First", rating: 5 }, { createdAt: new Date("2026-10-20T15:00:00Z") }).id;
    createTestimonial(projectId, { name: "Bo", text: "Second" }, { createdAt: new Date("2026-10-21T07:00:00Z") });
    createTestimonial(projectId, { name: "Manual", text: "By hand" }, { source: "manual", createdAt: new Date("2026-10-21T07:30:00Z") });
    // Before the hour: nothing yet.
    expect(runDigests(new Date("2026-10-21T07:45:00Z"))).toBe(0);
    expect(runDigests(new Date("2026-10-21T08:05:00Z"))).toBe(1);
    expect(runDigests(new Date("2026-10-21T08:20:00Z"))).toBe(0);
    expect(runDigests(new Date("2026-10-21T23:59:00Z"))).toBe(0);
    await runDueJobs();
    const sent = await mails();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("2 new testimonials in the last day");
    expect(sent[0].text).toContain("First");
    expect(sent[0].text).toContain("Second");
    expect(sent[0].text).not.toContain("By hand");
    expect(sent[0].text).toContain(id1);
    // Next day: only what came after the last digest.
    createTestimonial(projectId, { name: "Cy", text: "Third" }, { createdAt: new Date("2026-10-21T12:00:00Z") });
    expect(runDigests(new Date("2026-10-22T08:00:00Z"))).toBe(1);
    await runDueJobs();
    const next = (await mails()).filter((m) => m.subject.startsWith("1 new"));
    expect(next).toHaveLength(1);
    expect(next[0].text).toContain("Third");
    expect(next[0].text).not.toContain("First");
    // A day with nothing new sends nothing.
    expect(runDigests(new Date("2026-10-23T09:00:00Z"))).toBe(0);
  });

  it("INT-01 weekly pending reminder on Mondays and the monthly report on the 1st", async () => {
    process.env.DIGEST_HOUR_UTC = "8";
    recordSignIn(ADMIN_EMAIL);
    setPrefs(ADMIN_EMAIL, { weeklyPending: true, monthlyReport: true });
    getDb().update(schema.memberPrefs).set({ lastWeeklyAt: new Date("2026-09-20T00:00:00Z"), lastMonthlyAt: new Date("2026-09-20T00:00:00Z") }).run();
    createTestimonial(projectId, { name: "Ada", text: "Waiting", rating: 4 }, { createdAt: new Date("2026-09-10T10:00:00Z") });
    const approved = createTestimonial(projectId, { name: "Bo", text: "Live", rating: 5 }, { createdAt: new Date("2026-09-12T10:00:00Z") });
    updateTestimonial(approved.id, { status: "approved" });
    // Thursday 1 October 2026, 09:00: the monthly report (and the weekly one, last due Monday 28 September).
    const now = new Date("2026-10-01T09:00:00Z");
    expect(weeklyBoundary(now).toISOString()).toBe("2026-09-28T08:00:00.000Z");
    expect(monthlyBoundary(now).toISOString()).toBe("2026-10-01T08:00:00.000Z");
    expect(dailyBoundary(new Date("2026-10-01T07:00:00Z")).toISOString()).toBe("2026-09-30T08:00:00.000Z");
    expect(runDigests(now)).toBe(2);
    expect(runDigests(new Date("2026-10-01T10:00:00Z"))).toBe(0);
    await runDueJobs();
    const sent = await mails();
    const weekly = sent.find((m) => /waiting for review/.test(m.subject))!;
    expect(weekly.subject).toBe("1 testimonial is waiting for review");
    expect(weekly.text).toContain("Acme: 1 waiting");
    const monthly = sent.find((m) => /in September 2026/.test(m.subject))!;
    expect(monthly.text).toContain("2 received, 1 approved, 0 with video, average 4.5★");
  });

  it("INT-01 an import summary when an import finishes", async () => {
    recordSignIn(ADMIN_EMAIL);
    setPrefs(ADMIN_EMAIL, { importSummary: true });
    const project = getDb().select().from(schema.projects).get()!;
    getDb()
      .insert(schema.taskRuns)
      .values({ id: crypto.randomUUID(), projectId, kind: "import", subject: "appstore", status: "done", done: 20, duplicates: 3, total: 23, createdAt: new Date(), finishedAt: new Date() })
      .run();
    emitEvent("import.completed", project, { import: {} });
    await runDueJobs();
    const sent = await mails();
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Import finished for Acme: 20 new");
    expect(sent[0].text).toContain("20 imported, 3 already there");
  });
});
