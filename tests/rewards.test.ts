import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as poolRoute, POST as addCodesRoute, DELETE as removeCodesRoute } from "@/app/api/admin/forms/[id]/reward-codes/route";
import { POST as submitRoute } from "@/app/api/projects/[slug]/forms/[form]/submissions/route";
import { getDb, schema } from "@/db";
import { addRecipients, campaignRewardPool, createCampaign, importRows, updateCampaign } from "@/lib/campaigns";
import { outboxDir } from "@/lib/email";
import { createForm, FormError, getDefaultForm, getForm, updateForm } from "@/lib/forms";
import { inLowRatingBranch, visiblePages } from "@/lib/forms/engine";
import { formPagesSchema, parseFormRow } from "@/lib/forms/schema";
import { runDueJobs } from "@/lib/jobs";
import { campaignEmail, getRequest, requestToken, SAMPLE_CODE, sendThankYou, THANK_YOU_JOB } from "@/lib/requests";
import { addCodes, claimCode, grantReward, parseCodes, poolStats, releaseCodes, spinWheel } from "@/lib/rewards";
import { pickPrize, rewardConfigSchema, type RewardConfig } from "@/lib/rewards-config";
import { resetRateLimits } from "@/lib/rate-limit";
import { createProject, getProjectById } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, formSubmission, params, submitFormRequest, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  resetRateLimits();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.MAIL_OUTBOX;
  ctx.cleanup();
});

const PAGES = formPagesSchema.parse([
  { type: "rating" },
  { type: "question", key: "q1", primary: true, title: "What changed?", mode: "text" },
  { type: "consent" },
  { type: "about_you", fields: { email: { enabled: true } } },
  { type: "thank_you" },
]);

function makeForm(o: { reward?: Partial<RewardConfig>; lowRating?: object } = {}) {
  const form = createForm(projectId, { name: "Stories", slug: "stories" });
  const cfg = parseFormRow(form);
  return updateForm(form.id, {
    pages: PAGES,
    settings: { ...cfg.settings, ...(o.lowRating ? { lowRating: { ...cfg.settings.lowRating, ...o.lowRating } } : {}) },
    ...(o.reward ? { reward: o.reward } : {}),
  })!;
}

const testimonial = (rating: number, extra: object = {}) => ({
  rating,
  answers: [{ key: "q1", text: "It made our week" }],
  person: { name: "Ada", email: "ada@example.com" },
  consent: { agreed: true },
  ...extra,
});

async function send(payload: object, ip = "203.0.113.7") {
  const res = await submitRoute(submitFormRequest("acme", "stories", formSubmission(payload), ip), params({ slug: "acme", form: "stories" }));
  return { status: res.status, body: await res.json() };
}

const count = (table: typeof schema.testimonials | typeof schema.feedback) => getDb().select().from(table).all().length;

describe("rewards (FORM-13)", () => {
  it("FORM-13 wheel odds hold within ±2% over 10,000 simulated spins", () => {
    const prizes = [{ weight: 50 }, { weight: 30 }, { weight: 15 }, { weight: 5 }];
    const hits = [0, 0, 0, 0];
    const SPINS = 10_000;
    for (let i = 0; i < SPINS; i++) hits[spinWheel(prizes)]++;
    prizes.forEach((p, i) => expect(Math.abs((hits[i] / SPINS) * 100 - p.weight)).toBeLessThanOrEqual(2));
  });

  it("FORM-13 pickPrize lays the weights end to end on [0, 1), and a 0% prize is never picked", () => {
    expect(pickPrize([25, 75], 0)).toBe(0);
    expect(pickPrize([25, 75], 0.2499)).toBe(0);
    expect(pickPrize([25, 75], 0.25)).toBe(1);
    expect(pickPrize([25, 75], 0.9999999)).toBe(1);
    expect(pickPrize([0, 100, 0], 0)).toBe(1);
    expect(pickPrize([0, 100, 0], 0.99999)).toBe(1);
  });

  it("FORM-13 the settings are checked: a code, an http(s) link, and wheel chances that add up to 100%", () => {
    const form = makeForm();
    const refuse = (reward: object, message: RegExp) => {
      expect(() => updateForm(form.id, { reward })).toThrow(message);
    };
    refuse({ mode: "same", kind: "code", code: "" }, /coupon code/);
    refuse({ mode: "same", kind: "url", url: "javascript:alert(1)" }, /https/);
    refuse({ mode: "wheel", prizes: [{ id: "a", label: "10% off", weight: 60 }] }, /two prizes/);
    refuse({ mode: "wheel", prizes: [{ id: "a", label: "10% off", weight: 60 }, { id: "b", label: "Mug", weight: 30 }] }, /add up to 100% \(now 90%\)/);
    expect(rewardConfigSchema.safeParse({ mode: "wheel", prizes: [{ id: "a", label: "A", weight: 33.33 }, { id: "b", label: "B", weight: 66.67 }] }).success).toBe(true);
    // The classic page has no thank-you step to show it on.
    expect(() => updateForm(getDefaultForm(projectId).id, { reward: { mode: "same", kind: "code", code: "X" } })).toThrow(FormError);
  });

  it("FORM-13 a form without a reward answers exactly as before", async () => {
    makeForm();
    const { status, body } = await send(testimonial(5));
    expect(status).toBe(201);
    expect(Object.keys(body).sort()).toEqual(["id", "message", "ok", "thankYou", "withdrawUrl"]);
  });

  it("FORM-13 the same code for everyone is delivered once per submission, on the thank-you page and in the receipt email", async () => {
    process.env.MAIL_OUTBOX = "true";
    const form = makeForm({ reward: { mode: "same", kind: "code", code: "THANKS10", message: "10% off your next order" } });
    const project = getProjectById(projectId)!;
    const [r] = (await import("@/lib/requests")).createRequests(project, [{ email: "ivy@example.com", name: "Ivy" }], { send: false, formId: form.id }).created;
    const { body } = await send(testimonial(4, { requestToken: requestToken(r.id) }));
    expect(body.reward).toEqual({ status: "given", title: "", message: "10% off your next order", code: "THANKS10", url: null });
    const jobs = getDb().select().from(schema.jobs).all().filter((j) => j.type === THANK_YOU_JOB);
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload).reward.code).toBe("THANKS10");
    await sendThankYou(JSON.parse(jobs[0].payload));
    const mail = fs.readdirSync(outboxDir()).map((f) => fs.readFileSync(path.join(outboxDir(), f), "utf8")).join("\n");
    expect(mail).toContain("Your code: THANKS10");
    expect(mail).toContain("A thank-you from Acme");
  });

  it("FORM-13 a link reward hands out the link", async () => {
    makeForm({ reward: { mode: "same", kind: "url", url: "https://acme.example/gift" } });
    expect((await send(testimonial(5))).body.reward).toMatchObject({ status: "given", code: null, url: "https://acme.example/gift" });
  });

  it("FORM-13 unique codes from a CSV pool: one each, the pool goes down by one, claim tracking names the person, then a graceful sold-out", async () => {
    const form = makeForm({ reward: { mode: "same", kind: "pool" } });
    const add = await addCodesRoute(
      new Request(`http://localhost/api/admin/forms/${form.id}/reward-codes`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ text: "code\nAAA-1\nBBB-2\nAAA-1\nbad code\twith tab\n" }) }),
      params({ id: form.id }),
    );
    expect(add.status).toBe(201);
    expect(await add.json()).toMatchObject({ added: 2, duplicates: 1, invalid: 1, stats: { total: 2, claimed: 0, left: 2 } });

    const first = (await send(testimonial(5, { person: { name: "Ada" } }), "203.0.113.1")).body;
    expect(first.reward).toMatchObject({ status: "given", code: "AAA-1" });
    expect(poolStats(form.id)).toEqual({ total: 2, claimed: 1, left: 1 });
    const second = (await send(testimonial(5, { person: { name: "Bo" } }), "203.0.113.2")).body;
    expect(second.reward.code).toBe("BBB-2");
    const third = (await send(testimonial(5, { person: { name: "Cy" } }), "203.0.113.3")).body;
    expect(third.reward).toEqual({ status: "sold_out", title: "", message: "" });
    expect(count(schema.testimonials)).toBe(3);

    const pool = await (await poolRoute(new Request("http://localhost", { headers: adminHeaders() }), params({ id: form.id }))).json();
    expect(pool.stats).toEqual({ total: 2, claimed: 2, left: 0 });
    expect(pool.claims.map((c: { code: string; who: string; via: string }) => [c.code, c.who, c.via]).sort()).toEqual([
      ["AAA-1", "Ada", "testimonial"],
      ["BBB-2", "Bo", "testimonial"],
    ]);
    // Removing unused codes leaves the claimed ones for the record.
    addCodes(form, "CCC-3");
    const removed = await (await removeCodesRoute(new Request("http://localhost", { method: "DELETE", headers: adminHeaders() }), params({ id: form.id }))).json();
    expect(removed).toMatchObject({ removed: 1, stats: { total: 2, claimed: 2, left: 0 } });
  });

  it("FORM-13 two submissions at the same moment never get the same code", async () => {
    const form = makeForm({ reward: { mode: "same", kind: "pool" } });
    addCodes(form, "ONE\nTWO\nTHREE");
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => send(testimonial(5, { person: { name: `P${i}` } }), `198.51.100.${i + 1}`)));
    const codes = results.map((r) => r.body.reward).filter((r) => r.status === "given").map((r) => r.code);
    expect(codes.sort()).toEqual(["ONE", "THREE", "TWO"]);
    expect(results.filter((r) => r.body.reward.status === "sold_out")).toHaveLength(3);
    // And at the lowest level: one claim per call, never the same row twice.
    const other = createForm(projectId, { name: "Other", slug: "other" });
    addCodes(other, "X1\nX2");
    const claims = [claimCode(getDb(), other.id, {}), claimCode(getDb(), other.id, {}), claimCode(getDb(), other.id, {})];
    expect(claims).toEqual(["X1", "X2", null]);
  });

  it("FORM-13 a claim is released when its submission couldn't be stored, unless it was reserved for a recipient", () => {
    const form = makeForm();
    addCodes(form, "R1");
    const t = getDb().select().from(schema.testimonials).get();
    expect(t).toBeUndefined();
    const db = getDb();
    db.insert(schema.testimonials).values({ id: "t1", projectId, authorName: "X", consentAt: new Date() }).run();
    expect(claimCode(db, form.id, { testimonialId: "t1" })).toBe("R1");
    expect(poolStats(form.id).left).toBe(0);
    releaseCodes(db, { testimonialId: "t1" });
    expect(poolStats(form.id).left).toBe(1);
  });

  it("FORM-13 the wheel is spun on the server: what the browser sends can't pick the prize, and other prizes' codes stay hidden", async () => {
    makeForm({
      reward: {
        mode: "wheel",
        prizes: [
          { id: "big", label: "Free year", code: "FREEYEAR", weight: 0 },
          { id: "mug", label: "A mug", code: "MUG", weight: 100 },
        ],
      },
    });
    for (let i = 0; i < 5; i++) {
      const { body } = await send(testimonial(5, { reward: { won: 0, code: "FREEYEAR" }, wheel: 0 }), `192.0.2.${i + 1}`);
      expect(body.reward).toMatchObject({ status: "given", code: "MUG", wheel: { labels: ["Free year", "A mug"], chances: [0, 100], won: 1 } });
      expect(JSON.stringify(body)).not.toContain("FREEYEAR");
    }
  });

  it("FORM-13 only for video: the format is the only condition, never the rating or the words", () => {
    const form = makeForm({ reward: { mode: "same", kind: "code", code: "VID", onlyVideo: true } });
    const grant = (o: { hasVideo: boolean; privateFeedback: boolean }) => grantReward(getDb(), { form: getForm(form.id)!, request: null, target: {}, ...o });
    expect(grant({ hasVideo: false, privateFeedback: false })).toBeNull();
    expect(grant({ hasVideo: true, privateFeedback: false })).toMatchObject({ code: "VID" });
    // People sent to private feedback can't record a video, so they still qualify.
    expect(grant({ hasVideo: false, privateFeedback: true })).toMatchObject({ code: "VID" });
  });

  it("FORM-13 compliance: the reward is the same at 1 star and 5 stars, and the reward code never reads the rating, the words or the consent", async () => {
    makeForm({ reward: { mode: "same", kind: "code", code: "SAME" } });
    const low = (await send(testimonial(1), "203.0.113.20")).body.reward;
    const high = (await send(testimonial(5), "203.0.113.21")).body.reward;
    expect(low).toEqual(high);
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const file of ["src/lib/rewards.ts", "src/lib/rewards-config.ts"]) {
      const code = strip(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"));
      expect(code).not.toMatch(/rating|stars?\b|consent|\.text\b|answers/i);
    }
  });

  it("FORM-13 codes are read one per line or from a CSV's first column, with a header skipped", () => {
    expect(parseCodes('Code,Note\n"SPRING-1",first\nSPRING-2\n\n  SPRING-3  \n')).toEqual({ codes: ["SPRING-1", "SPRING-2", "SPRING-3"], invalid: [] });
    expect(parseCodes("ok-1\n has\u0007bell").invalid).toHaveLength(1);
  });
});

describe("the low-rating branch (FORM-12)", () => {
  it("FORM-12 is off by default: a 1-star submission is a testimonial, as before", async () => {
    const form = makeForm();
    expect(parseFormRow(form).settings.lowRating).toMatchObject({ enabled: false, threshold: 2 });
    const { status, body } = await send(testimonial(1));
    expect(status).toBe(201);
    expect(body.feedbackOnly).toBeUndefined();
    expect(count(schema.testimonials)).toBe(1);
  });

  it("FORM-12 the runner swaps the questions for a private feedback step at or below the threshold", () => {
    const cfg = { pages: PAGES, settings: { lowRating: { enabled: true, threshold: 2, title: "", subtitle: "", placeholder: "", askContact: true } } };
    expect(visiblePages(cfg, { rating: 0 }).map((p) => p.type)).toEqual(["rating", "question", "consent", "about_you"]);
    expect(visiblePages(cfg, { rating: 2 }).map((p) => p.type)).toEqual(["rating", "feedback"]);
    expect(visiblePages(cfg, { rating: 3 }).map((p) => p.type)).toEqual(["rating", "question", "consent", "about_you"]);
    expect(inLowRatingBranch({ ...cfg, settings: { lowRating: { ...cfg.settings.lowRating, enabled: false } } }, 1)).toBe(false);
    // Without the rating page nobody is rated, so it never applies.
    expect(inLowRatingBranch({ ...cfg, pages: PAGES.filter((p) => p.type !== "rating") }, 1)).toBe(false);
  });

  it("FORM-12 a low rating is stored as private feedback, not as a testimonial, and feedback.created fires", async () => {
    makeForm({ lowRating: { enabled: true, threshold: 2 } });
    getDb().insert(schema.webhooks).values({ id: "h1", url: "https://hooks.example/x", secret: "s", events: JSON.stringify(["feedback.created"]), projectId, active: true, createdAt: new Date() }).run();
    const { status, body } = await send({ rating: 2, lowFeedback: "The delivery was late", person: { name: "Ann", email: "ann@example.com" } });
    expect(status).toBe(201);
    expect(body).toMatchObject({ feedbackOnly: true, withdrawUrl: null });
    expect(body.thankYou.copyText).toBe(false);
    expect(count(schema.testimonials)).toBe(0);
    const [note] = getDb().select().from(schema.feedback).all();
    expect(note).toMatchObject({ source: "low-rating", rating: 2, text: "The delivery was late", authorName: "Ann", authorEmail: "ann@example.com", testimonialId: null });
    const deliveries = getDb().select().from(schema.webhookDeliveries).all();
    expect(deliveries.map((d) => d.event)).toEqual(["feedback.created"]);
    expect(JSON.parse(deliveries[0].payload).data.feedback).toMatchObject({ source: "low-rating", rating: 2 });
  });

  it("FORM-12 a rating above the threshold goes through the questions as usual, and a low one needs its feedback", async () => {
    makeForm({ lowRating: { enabled: true, threshold: 2 } });
    expect((await send(testimonial(3))).status).toBe(201);
    expect(count(schema.testimonials)).toBe(1);
    // The server makes the same call as the runner: a 1-star with answers but no feedback is refused, not published.
    const refused = await send(testimonial(1), "203.0.113.30");
    expect(refused.status).toBe(400);
    expect(count(schema.testimonials)).toBe(1);
  });

  it("FORM-12 FORM-13 a 1-star submission diverted to private feedback receives the same reward as everyone else", async () => {
    makeForm({ lowRating: { enabled: true, threshold: 2 }, reward: { mode: "same", kind: "pool", onlyVideo: true } });
    addCodes(getForm(getDb().select().from(schema.forms).where(eq(schema.forms.slug, "stories")).get()!.id)!, "LOW-1\nHIGH-1");
    const low = await send({ rating: 1, lowFeedback: "Not great" }, "203.0.113.40");
    expect(low.body.reward).toMatchObject({ status: "given", code: "LOW-1" });
    const claim = getDb().select().from(schema.rewardCodes).where(eq(schema.rewardCodes.code, "LOW-1")).get()!;
    expect(claim.feedbackId).toBe(getDb().select().from(schema.feedback).get()!.id);
  });

  it("FORM-12 a request link counts as answered, and the receipt says thanks for the feedback (no withdrawal link)", async () => {
    process.env.MAIL_OUTBOX = "true";
    const form = makeForm({ lowRating: { enabled: true, threshold: 2 } });
    const { createRequests } = await import("@/lib/requests");
    const [r] = createRequests(getProjectById(projectId)!, [{ email: "rae@example.com", name: "Rae" }], { send: false, formId: form.id }).created;
    await send({ rating: 1, lowFeedback: "Slow", requestToken: requestToken(r.id) });
    expect(getRequest(r.id)).toMatchObject({ status: "responded", testimonialId: null });
    await runDueJobs({ now: () => new Date(Date.now() + 1000) });
    const mail = fs.readdirSync(outboxDir()).map((f) => fs.readFileSync(path.join(outboxDir(), f), "utf8")).join("\n");
    expect(mail).toContain("Thanks for your feedback for Acme");
    expect(mail).not.toMatch(/withdraw/i);
  });

  it("FORM-12 the classic page can't use it", () => {
    const def = getDefaultForm(projectId);
    const cfg = parseFormRow(def);
    expect(() => updateForm(def.id, { settings: { ...cfg.settings, lowRating: { ...cfg.settings.lowRating, enabled: true } } })).toThrow(FormError);
  });
});

describe("per-recipient reward codes (REQ-08)", () => {
  async function campaignWith(body: string) {
    const project = getProjectById(projectId)!;
    const form = makeForm();
    addCodes(form, "C-1\nC-2\nC-3");
    let c = createCampaign(project, { name: "Spring", formId: form.id });
    c = updateCampaign(project, c, { rewardCodes: true, body, subject: "Hi {{first_name}}" });
    const { created } = addRecipients(project, c, importRows(project, { kind: "paste", text: "Ann, ann@example.com\nBen, ben@example.com" }));
    return { project, form, c, created };
  }

  it("REQ-08 {{reward_code}} reserves each recipient's own code when their email goes out, and reminders repeat it", async () => {
    const { project, form, c, created } = await campaignWith("Your code: {{reward_code}}\n\n{{link}}");
    const ann = campaignEmail(project, c, getRequest(created[0].id)!, "invite");
    const ben = campaignEmail(project, c, getRequest(created[1].id)!, "invite");
    expect(ann.text).toContain("Your code: C-1");
    expect(ben.text).toContain("Your code: C-2");
    expect(campaignEmail(project, c, getRequest(created[0].id)!, "reminder").text).toContain("Your code: C-1");
    expect(poolStats(form.id)).toEqual({ total: 3, claimed: 2, left: 1 });
    expect(campaignRewardPool(project, c)).toMatchObject({ formId: form.id, formName: "Stories", left: 1 });

    // Ann responds: her thank-you page shows the same code, and no second one is claimed.
    const { body } = await send(testimonial(5, { requestToken: requestToken(created[0].id) }));
    expect(body.reward).toMatchObject({ status: "given", code: "C-1" });
    expect(poolStats(form.id).claimed).toBe(2);
    const row = getDb().select().from(schema.rewardCodes).where(eq(schema.rewardCodes.code, "C-1")).get()!;
    expect(row).toMatchObject({ requestId: created[0].id, testimonialId: body.id });
  });

  it("REQ-08 the preview never reserves a code", async () => {
    const { project, form, c, created } = await campaignWith("Code {{reward_code}} {{link}}");
    expect(campaignEmail(project, c, getRequest(created[0].id)!, "invite", { preview: true }).text).toContain(`Code ${SAMPLE_CODE}`);
    expect(poolStats(form.id).claimed).toBe(0);
  });

  it("REQ-08 without {{reward_code}} in the email, each recipient's code is claimed when they respond", async () => {
    const { project, form, c, created } = await campaignWith("Hello {{link}}");
    expect(campaignEmail(project, c, getRequest(created[1].id)!, "invite").text).not.toContain("C-");
    expect(poolStats(form.id).claimed).toBe(0);
    const { body } = await send(testimonial(2, { requestToken: requestToken(created[1].id) }));
    expect(body.reward).toMatchObject({ status: "given", code: "C-1" });
    expect(getDb().select().from(schema.rewardCodes).where(eq(schema.rewardCodes.code, "C-1")).get()!.requestId).toBe(created[1].id);
  });

  it("REQ-08 people outside the campaign get the form's own reward, not a recipient code", async () => {
    const { form } = await campaignWith("{{reward_code}} {{link}}");
    updateForm(form.id, { reward: { mode: "same", kind: "code", code: "OPEN" } });
    expect((await send(testimonial(5))).body.reward).toMatchObject({ code: "OPEN" });
    expect(poolStats(form.id).claimed).toBe(0);
  });
});
