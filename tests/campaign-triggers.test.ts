import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as listTriggersRoute, POST as createTriggerRoute } from "@/app/api/admin/campaigns/[id]/triggers/route";
import { PATCH as patchTriggerRoute } from "@/app/api/admin/campaigns/[id]/triggers/[triggerId]/route";
import { POST as teamInvite } from "@/app/api/admin/team/route";
import { POST as shopifyHook } from "@/app/api/hooks/shopify/[id]/route";
import { POST as stripeHook } from "@/app/api/hooks/stripe/[id]/route";
import type { Project } from "@/db/schema";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { createCampaign, getCampaign, updateCampaign } from "@/lib/campaigns";
import { stripeSignature } from "@/lib/campaign-triggers";
import { listRequests } from "@/lib/requests";
import { createProject } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let project: Project;
let campaignId: string;
const SECRET = "whsec_test_0123456789abcdef";

const admin = (url: string, body?: unknown, method = body === undefined ? "GET" : "POST", cookie = adminHeaders().cookie) =>
  new Request(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie, "sec-fetch-site": "same-origin", "content-type": "application/json" } });

async function newTrigger(provider: "stripe" | "shopify", extra: Record<string, unknown> = {}) {
  const res = await createTriggerRoute(admin(`/api/admin/campaigns/${campaignId}/triggers`, { provider, delayDays: 7, secret: SECRET, ...extra }), params({ id: campaignId }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()).trigger as { id: string; url: string; secretSet: boolean };
}

const stripeEvent = (o: Record<string, unknown> = {}, type = "checkout.session.completed", id = `evt_${crypto.randomUUID()}`) =>
  JSON.stringify({ id, type, data: { object: { payment_status: "paid", customer_details: { email: "Ada@Example.com", name: "Ada Lovelace" }, ...o } } });

function sendStripe(id: string, raw: string, header = stripeSignature(SECRET, raw)) {
  return stripeHook(new Request(`http://localhost/api/hooks/stripe/${id}`, { method: "POST", body: raw, headers: { "stripe-signature": header, "content-type": "application/json" } }), params({ id }));
}

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  process.env.MAIL_OUTBOX = "true";
  project = createProject({ name: "Shop", slug: "shop" });
  const c = createCampaign(project, { name: "After purchase" });
  updateCampaign(project, c, { status: "active" });
  campaignId = c.id;
});
afterEach(() => {
  delete process.env.MAIL_OUTBOX;
  ctx.cleanup();
});

describe("REQ-07 Stripe trigger", () => {
  it("REQ-07 a signed checkout.session.completed queues the buyer's invite N days later, once", async () => {
    const t = await newTrigger("stripe");
    expect(t.url).toBe(`http://localhost:3000/api/hooks/stripe/${t.id}`);
    const raw = stripeEvent({}, "checkout.session.completed", "evt_1");
    const res = await sendStripe(t.id, raw);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, inviteId: expect.any(String) });
    const due = Date.parse(body.scheduledFor) - Date.now();
    expect(due).toBeGreaterThan(6.9 * 86_400_000);
    expect(due).toBeLessThan(7.1 * 86_400_000);
    const [invite] = listRequests(project.id, { campaignId });
    expect(invite).toMatchObject({ email: "ada@example.com", name: "Ada Lovelace", emailStatus: "queued" });

    // Stripe retries the same event: no second invite.
    expect(await (await sendStripe(t.id, raw)).json()).toMatchObject({ duplicate: true });
    expect(listRequests(project.id, { campaignId })).toHaveLength(1);
  });

  it("REQ-07 refuses a wrong signature or an old timestamp, and ignores unpaid sessions and other events", async () => {
    const t = await newTrigger("stripe");
    const raw = stripeEvent();
    expect((await sendStripe(t.id, raw, stripeSignature("whsec_someone_else_000", raw))).status).toBe(400);
    expect((await sendStripe(t.id, raw, stripeSignature(SECRET, raw, Date.now() - 600_000))).status).toBe(400);
    expect((await sendStripe(t.id, `${raw} `, stripeSignature(SECRET, raw))).status).toBe(400);
    expect(await (await sendStripe(t.id, stripeEvent({ payment_status: "unpaid" }))).json()).toMatchObject({ ignored: "not paid yet" });
    expect(await (await sendStripe(t.id, stripeEvent({}, "customer.created"))).json()).toMatchObject({ ignored: expect.stringMatching(/customer.created/) });
    // invoice.paid carries the address elsewhere.
    const inv = JSON.stringify({ id: "evt_inv", type: "invoice.paid", data: { object: { customer_email: "grace@example.com", customer_name: "Grace" } } });
    expect((await (await sendStripe(t.id, inv)).json()).inviteId).toEqual(expect.any(String));
    expect(listRequests(project.id, { campaignId }).map((r) => r.email)).toEqual(["grace@example.com"]);
  });

  it("REQ-07 needs its secret first; a paused campaign answers 409 and the retry works once it's resumed", async () => {
    const res = await createTriggerRoute(admin(`/api/admin/campaigns/${campaignId}/triggers`, { provider: "stripe" }), params({ id: campaignId }));
    const bare = (await res.json()).trigger;
    expect(bare.secretSet).toBe(false);
    expect((await sendStripe(bare.id, stripeEvent())).status).toBe(409);

    const t = await newTrigger("stripe");
    updateCampaign(project, getCampaign(campaignId)!, { status: "paused" });
    const raw = stripeEvent({}, "checkout.session.completed", "evt_paused");
    expect((await sendStripe(t.id, raw)).status).toBe(409);
    updateCampaign(project, getCampaign(campaignId)!, { status: "active" });
    expect((await (await sendStripe(t.id, raw)).json()).inviteId).toEqual(expect.any(String));
  });
});

describe("REQ-07 Shopify trigger", () => {
  const sendShopify = (id: string, order: unknown, topic = "orders/fulfilled", secret = SECRET) => {
    const raw = JSON.stringify(order);
    const hmac = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    return shopifyHook(
      new Request(`http://localhost/api/hooks/shopify/${id}`, {
        method: "POST",
        body: raw,
        headers: { "x-shopify-hmac-sha256": hmac, "x-shopify-topic": topic, "x-shopify-webhook-id": crypto.randomUUID(), "content-type": "application/json" },
      }),
      params({ id }),
    );
  };

  it("REQ-07 a signed orders/fulfilled invites the customer; other topics and bad HMACs don't", async () => {
    const t = await newTrigger("shopify", { delayDays: 3 });
    const order = { id: 1, email: "lin@example.com", customer: { first_name: "Lin", last_name: "Chen" }, billing_address: { company: "Tea Co" } };
    expect((await sendShopify(t.id, order, "orders/fulfilled", "wrong-secret-123")).status).toBe(400);
    expect(await (await sendShopify(t.id, order, "orders/paid")).json()).toMatchObject({ ignored: expect.any(String) });
    const ok = await (await sendShopify(t.id, order)).json();
    expect(ok.inviteId).toEqual(expect.any(String));
    expect(listRequests(project.id, { campaignId })[0]).toMatchObject({ email: "lin@example.com", name: "Lin Chen", company: "Tea Co" });
  });
});

describe("REQ-07 trigger setup", () => {
  it("REQ-07 never sends the secret back, checks the events, and is for editors", async () => {
    const t = await newTrigger("stripe");
    const list = await (await listTriggersRoute(admin(`/api/admin/campaigns/${campaignId}/triggers`), params({ id: campaignId }))).text();
    expect(list).not.toContain(SECRET);
    expect(JSON.parse(list).triggers[0]).toMatchObject({ provider: "stripe", secretSet: true, events: ["checkout.session.completed", "invoice.paid"], delayDays: 7 });
    const bad = await patchTriggerRoute(admin(`/api/admin/campaigns/${campaignId}/triggers/${t.id}`, { events: ["orders/paid"] }, "PATCH"), params({ id: campaignId, triggerId: t.id }));
    expect(bad.status).toBe(400);

    await teamInvite(admin("/api/admin/team", { email: "vi@example.com", role: "viewer" }));
    const viewer = `${sessionCookieName()}=${createSessionToken("vi@example.com")}`;
    const refused = await createTriggerRoute(admin(`/api/admin/campaigns/${campaignId}/triggers`, { provider: "shopify" }, "POST", viewer), params({ id: campaignId }));
    expect(refused.status).toBe(403);
  });
});
