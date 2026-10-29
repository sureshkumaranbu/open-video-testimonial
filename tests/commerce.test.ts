import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as purchaseHookRoute } from "@/app/api/hooks/stripe-purchases/[id]/route";
import { DELETE as deletePurchasesRoute } from "@/app/api/admin/projects/[id]/purchases/route";
import { DELETE as disconnectRoute, GET as stripeGet, PUT as stripePut } from "@/app/api/admin/projects/[id]/stripe/route";
import { PUT as verifiedRoute } from "@/app/api/admin/testimonials/[id]/verified-purchase/route";
import { POST as submitRoute } from "@/app/api/projects/[slug]/forms/[form]/submissions/route";
import { GET as widgetFeed } from "@/app/api/widget/[slug]/route";
import { GET as widgetHtml } from "@/app/api/widget/[slug]/html/route";
import { getDb, schema } from "@/db";
import { stripeSignature } from "@/lib/campaign-triggers";
import { deleteExpiredPurchases, emailHash, hasPurchase, legacyEmailHash, purchaseFromStripe, purchaseMatchKey } from "@/lib/commerce/purchases";
import { fillSalesLine } from "@/lib/commerce/sales-feed";
import { createForm, updateForm } from "@/lib/forms";
import { formPagesSchema, parseFormRow } from "@/lib/forms/schema";
import { resetRateLimits } from "@/lib/rate-limit";
import type { RewardConfig } from "@/lib/rewards-config";
import { rewardConfigSchema } from "@/lib/rewards-config";
import { createProject, createTestimonial, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { emitTestimonialEvent } from "@/lib/webhooks";
import { createWidget, widgetConfig, widgetPayload } from "@/lib/widgets";
import { registerJobs } from "@/lib/worker";
import { startFixtureServer } from "../e2e/fixtures/fixture-server.mjs";
import { adminHeaders, formSubmission, params, submitFormRequest, useTempDataDir } from "./helpers";

/** INT-07 (M18): the project's Stripe connection, purchases, "Verified purchase", the sales popup and thank-you coupons. */

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let stripe: Awaited<ReturnType<typeof startFixtureServer>>;
const SECRET = "whsec_purchases_0123456789";
const KEY = "rk_test_abcdefghijklmnop1234";

const admin = (url: string, body?: unknown, method = body === undefined ? "GET" : "PUT") =>
  new Request(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...adminHeaders(), "content-type": "application/json" } });

async function connect(extra: Record<string, unknown> = {}) {
  const res = await stripePut(admin(`/api/admin/projects/${projectId}/stripe`, { signingSecret: SECRET, ...extra }), params({ id: projectId }));
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return (await res.json()).connection as { id: string; url: string; signingSecretSet: boolean; restrictedKeySet: boolean };
}

const checkout = (o: Record<string, unknown> = {}, id = `evt_${crypto.randomUUID()}`) =>
  JSON.stringify({
    id,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000) - 7200,
    data: {
      object: {
        payment_status: "paid",
        amount_total: 2900,
        currency: "gbp",
        metadata: { product_name: "Pro plan" },
        customer_details: { email: "Priya@Example.com", name: "Priya Sharma", address: { line1: "1 High Street", city: "Leeds", postal_code: "LS1 1AA", country: "GB" } },
        payment_method_details: { card: { last4: "4242", brand: "visa" } },
        ...o,
      },
    },
  });

function sendHook(id: string, raw: string, header = stripeSignature(SECRET, raw)) {
  return purchaseHookRoute(new Request(`http://localhost/api/hooks/stripe-purchases/${id}`, { method: "POST", body: raw, headers: { "stripe-signature": header, "content-type": "application/json" } }), params({ id }));
}

const purchases = () => getDb().select().from(schema.purchases).all();

/** An approved, publicly consented testimonial. */
function approved(o: { name: string; email?: string; text: string }) {
  const t = createTestimonial(projectId, { ...o, consentPublic: true }, { source: "api" });
  updateTestimonial(t.id, { status: "approved" }, { quiet: true });
  return t;
}

beforeAll(async () => {
  stripe = await startFixtureServer({ port: 0 });
});
afterAll(async () => {
  await stripe.close();
});
beforeEach(async () => {
  ctx = useTempDataDir();
  registerJobs();
  resetRateLimits();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  process.env.STRIPE_API_URL = stripe.url;
  for (const p of ["/__requests", "/__responses"]) await fetch(`${stripe.url}${p}`, { method: "DELETE" });
});
afterEach(() => {
  delete process.env.STRIPE_API_URL;
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

describe("INT-07 purchases from Stripe", () => {
  it("INT-07 a signed checkout.session.completed keeps the first name, city, product, amount and time, never the email, last name, address or card", async () => {
    const c = await connect();
    expect(c.url).toBe(`http://localhost:3000/api/hooks/stripe-purchases/${c.id}`);
    const res = await sendHook(c.id, checkout({}, "evt_one"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, purchaseId: expect.any(String) });
    const [p] = purchases();
    expect(p).toMatchObject({ firstName: "Priya", place: "Leeds", product: "Pro plan", amount: 2900, currency: "gbp", eventType: "checkout.session.completed", externalId: "evt_one" });
    expect(Date.now() - p.purchasedAt.getTime()).toBeGreaterThan(7000 * 1000);
    expect(p.emailHash).toBe(emailHash(" priya@example.com "));
    const stored = JSON.stringify(p).toLowerCase();
    for (const secret of ["priya@example.com", "sharma", "high street", "ls1", "4242", "visa"]) expect(stored).not.toContain(secret);
    // Stripe retries: recorded once.
    expect(await (await sendHook(c.id, checkout({}, "evt_one"))).json()).toMatchObject({ duplicate: true });
    expect(purchases()).toHaveLength(1);
  });

  it("INT-07 refuses a wrong signature or an old one, ignores unpaid sessions and other events, and is 404 with the commerce flag off", async () => {
    const c = await connect();
    const raw = checkout();
    expect((await sendHook(c.id, raw, stripeSignature("whsec_someone_else_00", raw))).status).toBe(400);
    expect((await sendHook(c.id, raw, stripeSignature(SECRET, raw, Date.now() - 600_000))).status).toBe(400);
    expect((await sendHook(c.id, `${raw} `, stripeSignature(SECRET, raw))).status).toBe(400);
    expect(await (await sendHook(c.id, checkout({ payment_status: "unpaid" }))).json()).toMatchObject({ ignored: "not paid yet" });
    const other = JSON.stringify({ id: "evt_x", type: "customer.created", data: { object: {} } });
    expect(await (await sendHook(c.id, other)).json()).toMatchObject({ ignored: expect.stringMatching(/customer.created/) });
    expect(purchases()).toHaveLength(0);
    expect((await sendHook("nope", raw)).status).toBe(404);
    process.env.PLAUDIT_FEATURES = "forms,widgets";
    expect((await sendHook(c.id, raw)).status).toBe(404);
  });

  it("INT-07 invoice.paid: the product from the invoice line, a country's name when there's no city", () => {
    const facts = purchaseFromStripe({
      id: "evt_inv",
      type: "invoice.paid",
      data: { object: { customer_name: "Ada Lovelace", customer_email: "ada@example.com", customer_address: { country: "IN" }, amount_paid: 1200, currency: "usd", lines: { data: [{ description: "1 × Team plan (at $12.00 / month)" }] } } },
    });
    expect(facts).toMatchObject({ firstName: "Ada", place: "India", product: "Team plan", amount: 1200, currency: "usd", email: "ada@example.com" });
  });

  it("INT-07 the connection never sends its secrets back, and checks what it's given", async () => {
    const c = await connect({ restrictedKey: KEY });
    expect(c).toMatchObject({ signingSecretSet: true, restrictedKeySet: true });
    const res = await stripeGet(admin(`/api/admin/projects/${projectId}/stripe`), params({ id: projectId }));
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).connection.restrictedKeyHint).toBe("…1234");
    const bad = await stripePut(admin(`/api/admin/projects/${projectId}/stripe`, { restrictedKey: "sk_live_0123456789abcdef" }), params({ id: projectId }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/restricted key/);
    expect((await stripePut(admin(`/api/admin/projects/${projectId}/stripe`, { retentionDays: 0 }), params({ id: projectId }))).status).toBe(400);
  });

  it("INT-07 purchases go after the connection's retention (90 days by default), and on Delete all or Disconnect", async () => {
    const c = await connect();
    const old = checkout({}, "evt_old").replace(/"created":\d+/, `"created":${Math.floor(Date.now() / 1000) - 100 * 86400}`);
    await sendHook(c.id, old);
    await sendHook(c.id, checkout({}, "evt_new").replace(/"created":\d+/, `"created":${Math.floor(Date.now() / 1000) - 2 * 86400}`));
    expect(purchases()).toHaveLength(2);
    expect(deleteExpiredPurchases()).toBe(1);
    expect(purchases().map((p) => p.externalId)).toEqual(["evt_new"]);
    await connect({ retentionDays: 1 });
    expect(deleteExpiredPurchases()).toBe(1);
    await sendHook(c.id, checkout({}, "evt_now"));
    const del = await deletePurchasesRoute(admin(`/api/admin/projects/${projectId}/purchases`, undefined, "DELETE"), params({ id: projectId }));
    expect(await del.json()).toEqual({ removed: 1 });
    await sendHook(c.id, checkout({}, "evt_last"));
    expect((await disconnectRoute(admin(`/api/admin/projects/${projectId}/stripe`, undefined, "DELETE"), params({ id: projectId }))).status).toBe(204);
    expect(purchases()).toHaveLength(0);
    expect((await sendHook(c.id, checkout())).status).toBe(404);
  });
});

describe("INT-07 Verified purchase", () => {
  it("INT-07 a buyer's testimonials, from before and after the purchase, are marked by a hash of the email; widgets and walls say so", async () => {
    const before = approved({ name: "Priya", email: "priya@example.com", text: "Lovely" });
    const stranger = approved({ name: "Sam", email: "sam@example.com", text: "Fine" });
    const c = await connect();
    expect(await (await sendHook(c.id, checkout())).json()).toMatchObject({ marked: 1 });
    expect(getTestimonial(before.id)!.verifiedPurchaseAt).toBeInstanceOf(Date);
    expect(getTestimonial(stranger.id)!.verifiedPurchaseAt).toBeNull();

    const after = approved({ name: "Priya S", email: "PRIYA@example.com ", text: "Still lovely" });
    emitTestimonialEvent("testimonial.created", getTestimonial(after.id));
    expect(getTestimonial(after.id)!.verifiedPurchaseAt).toBeInstanceOf(Date);

    const w = createWidget(projectId, { name: "Grid", layout: "grid" });
    const items = widgetPayload({ id: projectId, name: "Acme", slug: "acme", accentColor: "#0f766e" }, w, widgetConfig(w)).testimonials;
    const priya = items.find((t) => t.id === before.id)!;
    expect(priya.extra).toMatchObject({ verifiedPurchase: true, verified: true, verifiedLabel: "Verified purchase" });
    expect(items.find((t) => t.id === stranger.id)!.extra).toMatchObject({ verified: false });
    expect(items.find((t) => t.id === stranger.id)!.extra.verifiedLabel).toBeUndefined();
    const html = await (await widgetHtml(new Request(`http://localhost/api/widget/${w.id}/html`), params({ slug: w.id }))).text();
    expect(html).toContain("Verified purchase");
  });

  it("INT-07 an editor can remove the mark, and put it back only while a matching purchase is on record", async () => {
    const t = createTestimonial(projectId, { name: "Priya", email: "priya@example.com", text: "Lovely" }, { source: "api" });
    const put = (verified: boolean) => verifiedRoute(admin(`/api/admin/testimonials/${t.id}/verified-purchase`, { verified }), params({ id: t.id }));
    expect((await put(true)).status).toBe(409);
    const c = await connect();
    await sendHook(c.id, checkout());
    expect(getTestimonial(t.id)!.verifiedPurchaseAt).toBeInstanceOf(Date);
    expect(await (await put(false)).json()).toEqual({ verifiedPurchaseAt: null });
    expect((await put(true)).status).toBe(200);
  });

  it("INT-07 nothing is marked when the connection says not to", async () => {
    const t = createTestimonial(projectId, { name: "Priya", email: "priya@example.com", text: "Lovely" }, { source: "api" });
    const c = await connect({ verifyPurchases: false });
    await sendHook(c.id, checkout());
    expect(getTestimonial(t.id)!.verifiedPurchaseAt).toBeNull();
  });
});

describe("INT-07 L25 the purchase matching key", () => {
  it("INT-07 L25 is this server's own random key, made on first use and kept in the database, so changing SESSION_SECRET doesn't stop purchases matching", async () => {
    expect(getDb().select().from(schema.serverKeys).all()).toEqual([]);
    const key = purchaseMatchKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(getDb().select().from(schema.serverKeys).all()).toMatchObject([{ name: "purchase-email", value: key }]);
    expect(purchaseMatchKey()).toBe(key);
    const t = createTestimonial(projectId, { name: "Priya", email: "priya@example.com", text: "Lovely" }, { source: "api" });
    const c = await connect();
    await sendHook(c.id, checkout());
    expect(purchases()[0].emailHash).not.toBe(legacyEmailHash("priya@example.com"));

    const secret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a-brand-new-session-secret-0123456789";
    try {
      expect(emailHash("priya@example.com")).toBe(purchases()[0].emailHash);
      expect(hasPurchase(projectId, "Priya@Example.com")).toBe(true);
      expect(await (await verifiedRoute(admin(`/api/admin/testimonials/${t.id}/verified-purchase`, { verified: true }), params({ id: t.id }))).json()).toMatchObject({ verifiedPurchaseAt: expect.any(String) });
    } finally {
      process.env.SESSION_SECRET = secret;
    }
  });

  it("INT-07 L25 a purchase recorded before the key existed (hashed with SESSION_SECRET) still matches", async () => {
    await connect();
    getDb().insert(schema.purchases).values({ id: crypto.randomUUID(), projectId, externalId: "evt_old", eventType: "invoice.paid", emailHash: legacyEmailHash("sam@example.com"), purchasedAt: new Date() }).run();
    expect(hasPurchase(projectId, " SAM@example.com")).toBe(true);
    expect(hasPurchase(projectId, "someone@example.com")).toBe(false);
    const t = approved({ name: "Sam", email: "sam@example.com", text: "Fine" });
    emitTestimonialEvent("testimonial.created", getTestimonial(t.id));
    expect(getTestimonial(t.id)!.verifiedPurchaseAt).toBeInstanceOf(Date);
  });
});

describe("INT-07 sales popup", () => {
  async function salesWidget(options: Record<string, unknown> = {}) {
    const w = createWidget(projectId, { name: "Popup", layout: "sales", config: { options } });
    const res = await widgetFeed(new Request(`http://localhost/api/widget/${w.id}`), params({ slug: w.id }));
    return { res, body: await res.json() };
  }

  it("INT-07 the public feed has only the display fields the owner picked, no cookies, and a short cache", async () => {
    const c = await connect();
    await sendHook(c.id, checkout());
    await sendHook(c.id, checkout({ customer_details: { name: "Jo", email: "jo@example.com", address: { country: "FR" } }, metadata: {} }));
    const { res, body } = await salesWidget({ salesAmount: true });
    expect(res.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=30");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(body.widget).toMatchObject({ layout: "sales", cta: null, aggregate: { show: false } });
    expect(body.widget.css).toContain(".e{display:none}");
    const sales = body.testimonials.map((t: { sale: object }) => t.sale);
    expect(sales).toHaveLength(2);
    expect(sales).toEqual(
      expect.arrayContaining([
        { line: "Priya from Leeds bought Pro plan", amount: "£29.00", at: expect.any(String) },
        { line: "Jo from France bought from us", amount: "£29.00", at: expect.any(String) },
      ]),
    );
    const raw = JSON.stringify(body).toLowerCase();
    for (const secret of ["example.com", "sharma", "high street", "emailhash", "purchasedat"]) expect(raw).not.toContain(secret);
  });

  it("INT-07 hidden details never leave the server, and approved snippets can be mixed in", async () => {
    const c = await connect();
    await sendHook(c.id, checkout());
    await sendHook(c.id, checkout());
    approved({ name: "Grace Hopper", text: "A ".repeat(200) + "very long story" });
    const { body } = await salesWidget({ salesName: false, salesPlace: false, salesProduct: false, salesTime: false, salesMix: true });
    const [a, b, snippet] = body.testimonials;
    expect(a.sale).toEqual({ line: "Someone bought from us", amount: null, at: null });
    expect(b.sale.line).toBe("Someone bought from us");
    expect(a.createdAt).toBe("");
    expect(JSON.stringify(body)).not.toMatch(/Priya|Leeds|Pro plan/);
    expect(snippet.sale).toBeUndefined();
    expect(snippet.name).toBe("Grace Hopper");
    expect(snippet.text.length).toBeLessThanOrEqual(140);
  });

  it("INT-07 is empty with the commerce flag off or without a connection, and purchases never reach the HTML include", async () => {
    expect((await salesWidget()).body.testimonials).toEqual([]);
    const c = await connect();
    await sendHook(c.id, checkout());
    const { body } = await salesWidget();
    expect(body.testimonials).toHaveLength(1);
    const html = await (await widgetHtml(new Request(`http://localhost/api/widget/${body.widget.id}/html?jsonld=1`), params({ slug: body.widget.id }))).text();
    expect(html).not.toContain("Priya");
    process.env.PLAUDIT_FEATURES = "forms,widgets";
    expect((await salesWidget()).body.testimonials).toEqual([]);
  });

  it("INT-07 the lines use the widget's own words", () => {
    expect(fillSalesLine("{name} aus {place} kaufte {product} {other}", { name: "Priya", place: "Leeds", product: "Pro" })).toBe("Priya aus Leeds kaufte Pro {other}");
  });

  it("INT-07 sales.js is accessible: a polite live region, a remembered close button and no motion for reduced-motion visitors", () => {
    const js = fs.readFileSync(path.resolve(__dirname, "../public/widget/sales.js"), "utf8");
    expect(js).toContain('setAttribute("aria-live", "polite")');
    expect(js).toContain("localStorage.setItem(key(id)");
    expect(js).toContain("prefers-reduced-motion:reduce");
    expect(js).toContain('close.setAttribute("aria-label", ctx.l.dismiss)');
  });
});

describe("INT-07 thank-you coupons", () => {
  const PAGES = formPagesSchema.parse([
    { type: "rating" },
    { type: "question", key: "q1", primary: true, title: "What changed?", mode: "text" },
    { type: "consent" },
    { type: "about_you", fields: { email: { enabled: true } } },
    { type: "thank_you" },
  ]);
  function makeForm(reward: Partial<RewardConfig>) {
    const form = createForm(projectId, { name: "Stories", slug: "stories" });
    return updateForm(form.id, { pages: PAGES, settings: parseFormRow(form).settings, reward })!;
  }
  const payload = (rating: number) => ({ rating, answers: [{ key: "q1", text: "It made our week" }], person: { name: "Ada", email: "ada@example.com" }, consent: { agreed: true } });
  async function send(rating: number, ip: string) {
    const res = await submitRoute(submitFormRequest("acme", "stories", formSubmission(payload(rating)), ip), params({ slug: "acme", form: "stories" }));
    return { status: res.status, body: await res.json() };
  }
  const canned = (body: object, status = 200) => fetch(`${stripe.url}/__responses`, { method: "PUT", body: JSON.stringify({ path: "/v1/promotion_codes", status, body, times: 1 }) });

  it("INT-07 a Stripe coupon needs its coupon id", () => {
    expect(rewardConfigSchema.safeParse({ mode: "same", kind: "stripe" }).success).toBe(false);
    expect(rewardConfigSchema.safeParse({ mode: "same", kind: "stripe", stripeCoupon: "THANKS10" }).success).toBe(true);
    expect(rewardConfigSchema.safeParse({ mode: "same", kind: "stripe", stripeCoupon: "no spaces" }).success).toBe(false);
  });

  it("INT-07 sending the form makes a single-use promotion code at Stripe with the project's restricted key, the same at 1 and 5 stars", async () => {
    await connect({ restrictedKey: KEY });
    const form = makeForm({ mode: "same", kind: "stripe", stripeCoupon: "THANKS10", stripeExpiresDays: 30, title: "A thank-you" });
    await canned({ id: "promo_1", code: "THANKS-AAA111" });
    const low = await send(1, "203.0.113.31");
    await canned({ id: "promo_2", code: "THANKS-BBB222" });
    const high = await send(5, "203.0.113.32");
    expect(low.status).toBe(201);
    expect(low.body.reward).toEqual({ status: "given", title: "A thank-you", message: "", code: "THANKS-AAA111", url: null });
    expect(high.body.reward).toMatchObject({ status: "given", code: "THANKS-BBB222" });
    const calls = stripe.requests("/v1/promotion_codes");
    expect(calls).toHaveLength(2);
    const sent = new URLSearchParams(calls[0].body);
    expect(sent.get("coupon")).toBe("THANKS10");
    expect(sent.get("max_redemptions")).toBe("1");
    expect(Number(sent.get("expires_at"))).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
    expect(sent.get("metadata[plaudit_testimonial]")).toBe(low.body.id);
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].headers["idempotency-key"]).toBe(`plaudit-reward-${low.body.id}`);
    expect(calls[0].headers["stripe-version"]).toEqual(expect.any(String));
    // Listed with the form's claimed codes; the call is in the audit log.
    const codes = getDb().select().from(schema.rewardCodes).where(eq(schema.rewardCodes.formId, form.id)).all();
    expect(codes.map((r) => [r.code, r.testimonialId])).toEqual(expect.arrayContaining([["THANKS-AAA111", low.body.id]]));
    const log = getDb().select().from(schema.auditLog).where(eq(schema.auditLog.action, "stripe.promotion_code")).all();
    expect(log).toHaveLength(2);
    expect(JSON.stringify(log)).not.toContain(KEY);
  });

  it("INT-07 when Stripe fails the person still gets the thank-you, and the owner sees why in the audit log", async () => {
    await connect({ restrictedKey: KEY });
    makeForm({ mode: "same", kind: "stripe", stripeCoupon: "GONE" });
    await canned({ error: { message: "No such coupon: 'GONE'", code: "resource_missing" } }, 400);
    const res = await send(4, "203.0.113.33");
    expect(res.status).toBe(201);
    expect(res.body.reward).toEqual({ status: "unavailable", title: "", message: "" });
    const [entry] = getDb().select().from(schema.auditLog).where(eq(schema.auditLog.action, "stripe.promotion_code_failed")).all();
    expect(entry.summary).toMatch(/No such coupon: 'GONE'/);
    expect(entry.projectId).toBe(projectId);
    // Without a restricted key there's no call at all.
    await connect({ restrictedKey: "" });
    expect((await send(4, "203.0.113.34")).body.reward.status).toBe("unavailable");
    expect(stripe.requests("/v1/promotion_codes")).toHaveLength(1);
  });

  it("INT-07 compliance: the coupon code's file never reads the rating, the words or the consent", () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const code = strip(fs.readFileSync(path.resolve(__dirname, "../src/lib/commerce/coupons.ts"), "utf8"));
    expect(code).not.toMatch(/rating|stars?\b|consent|\.text\b|answers/i);
  });
});

describe("INT-07 a rejected testimonial", () => {
  it("INT-07 keeps its mark off public pages: only approved testimonials are in any feed", async () => {
    const t = approved({ name: "Priya", email: "priya@example.com", text: "Lovely" });
    const c = await connect();
    await sendHook(c.id, checkout());
    updateTestimonial(t.id, { status: "rejected" });
    const w = createWidget(projectId, { name: "Grid", layout: "grid" });
    expect(widgetPayload({ id: projectId, name: "Acme", slug: "acme", accentColor: "#0f766e" }, w, widgetConfig(w)).testimonials).toEqual([]);
  });
});
