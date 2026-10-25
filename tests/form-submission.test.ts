import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as submitRoute } from "@/app/api/projects/[slug]/forms/[form]/submissions/route";
import { POST as legacyRoute } from "@/app/api/projects/[slug]/testimonials/route";
import { POST as uploadRoute } from "@/app/api/projects/[slug]/uploads/route";
import { getDb, schema } from "@/db";
import type { WebhookEvent } from "@/db/schema";
import { listAnswers } from "@/lib/answers";
import { listFeedback } from "@/lib/feedback";
import { createForm, getDefaultForm, setFormStatus, updateForm } from "@/lib/forms";
import { formPagesSchema, parseFormRow, type FormConfig } from "@/lib/forms/schema";
import { listImages } from "@/lib/images";
import { registerJobs } from "@/lib/worker";
import { createRequests, requestToken, THANK_YOU_JOB } from "@/lib/requests";
import { appendChunk, createUpload } from "@/lib/uploads";
import { resetRateLimits } from "@/lib/rate-limit";
import {
  createProject,
  getProjectById,
  getTestimonial,
  NoPublicConsentError,
  toPublic,
  updateTestimonial,
} from "@/lib/testimonials";
import {
  formSubmission,
  params,
  PNG_BYTES,
  submissionForm,
  submitFormRequest,
  submitRequest,
  useTempDataDir,
  WEBM_BYTES,
} from "./helpers";

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

const PAGES = [
  { type: "rating" },
  { type: "question", key: "q1", primary: true, title: "What changed?", mode: "video_text", allowImages: 3 },
  { type: "question", key: "q2", title: "Anything else?", required: false, mode: "text" },
  { type: "question", key: "q3", title: "Say hi on camera", mode: "video" },
  { type: "feedback", key: "note", title: "Anything just for us?" },
  { type: "consent", scopes: ["social", "ads"], allowPrivate: true },
  {
    type: "about_you",
    fields: { website: { enabled: true }, phone: { enabled: true }, socials: { enabled: true } },
    custom: [
      { key: "plan", type: "dropdown", label: "Plan", options: [{ label: "Starter" }, { label: "Enterprise", tag: "enterprise" }] },
      { key: "role_note", type: "short", label: "Role note" },
      { key: "story", type: "long", label: "Longer story" },
      { key: "agree_call", type: "checkbox", label: "Happy to talk" },
      { key: "nps", type: "nps", label: "NPS" },
      { key: "site", type: "url", label: "Site" },
      { key: "seats", type: "number", label: "Seats" },
    ],
  },
  { type: "thank_you", message: "Thanks from {project}!" },
];

function makeForm(settings: Partial<FormConfig["settings"]> = {}, pages: unknown[] = PAGES) {
  const form = createForm(projectId, { name: "SaaS", slug: "saas" });
  const cfg = parseFormRow(form);
  return updateForm(form.id, { pages: formPagesSchema.parse(pages), settings: { ...cfg.settings, ...settings } })!;
}

async function upload(bytes = WEBM_BYTES) {
  const { upload: u, token } = createUpload("video", { projectId, maxBytes: 10_000 });
  await appendChunk(u, 0, bytes);
  return { videoUpload: u.id, videoUploadToken: token };
}

const minimal = (over: Record<string, unknown> = {}) => ({
  rating: 5,
  answers: [{ key: "q1", text: "We ship twice as fast." }],
  person: { name: "Ada" },
  consent: { agreed: true },
  ...over,
});

async function send(payload: object, files: Record<string, File | File[]> = {}, o: { ip?: string; extra?: Record<string, string>; slug?: string } = {}) {
  const res = await submitRoute(
    submitFormRequest("acme", o.slug ?? "saas", formSubmission(payload, files, o.extra), o.ip),
    params({ slug: "acme", form: o.slug ?? "saas" }),
  );
  return { res, body: await res.json() };
}

function hook(events: WebhookEvent[], formId: string | null = null) {
  const id = crypto.randomUUID();
  getDb()
    .insert(schema.webhooks)
    .values({ id, url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: JSON.stringify(events), active: true, formId, createdAt: new Date() })
    .run();
  return id;
}
const deliveries = (event?: string) =>
  getDb()
    .select()
    .from(schema.webhookDeliveries)
    .all()
    .filter((d) => !event || d.event === event);

describe("FORM-04 several questions", () => {
  it("FORM-04 stores 3 answers, 2 of them videos from resumable uploads, and up to 3 images", async () => {
    makeForm();
    const v1 = await upload();
    const v3 = await upload();
    const png = () => new File([PNG_BYTES], "shot.png", { type: "image/png" });
    const { res, body } = await send(
      minimal({
        answers: [
          { key: "q1", text: "We ship twice as fast.", ...v1 },
          { key: "q2", text: "Support is great." },
          { key: "q3", ...v3 },
        ],
      }),
      { "images:q1": [png(), png(), png(), png()], "images:q2": [png()] },
    );
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.message).toBe("Thanks from Acme!");
    expect(body.withdrawUrl).toMatch(/\/w\//);
    const t = getTestimonial(body.id)!;
    expect(t).toMatchObject({ text: "We ship twice as fast.", primaryQuestion: "What changed?", source: "form", language: "en" });
    expect(t.videoKey).toMatch(/^videos\//);
    const answers = listAnswers(t.id);
    expect(answers.map((a) => [a.questionKey, a.text, Boolean(a.videoKey)])).toEqual([
      ["q2", "Support is great.", false],
      ["q3", null, true],
    ]);
    // q2 allows no images; q1 at most 3.
    expect(listImages(t.id).map((i) => i.questionKey)).toEqual(["q1", "q1", "q1"]);
  });

  it("FORM-05 an optional question can be skipped, a required one can't", async () => {
    makeForm();
    const v3 = await upload();
    expect((await send(minimal({ answers: [{ key: "q1", text: "Yes" }, { key: "q3", ...v3 }] }))).res.status).toBe(201);
    const { res, body } = await send(minimal());
    expect(res.status).toBe(400);
    expect(body.error).toContain("Say hi on camera");
  });

  it("FORM-04 refuses an upload for a text-only question", async () => {
    const form = makeForm();
    const start = (question: string) =>
      uploadRoute(
        new Request(`http://localhost/api/projects/acme/uploads?form=${form.id}&question=${question}`, { method: "POST", body: "{}" }),
        params({ slug: "acme" }),
      );
    const refused = await start("q2");
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/written answer/);
    expect((await start("q3")).status).toBe(201);
    expect((await start("nope")).status).toBe(400);
  });

  it("FORM-04 an expired or foreign upload is refused and nothing is kept", async () => {
    makeForm();
    const { res, body } = await send(minimal({ answers: [{ key: "q1", text: "x" }, { key: "q3", videoUpload: crypto.randomUUID(), videoUploadToken: "nope" }] }));
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/expired/);
    expect(getDb().select().from(schema.testimonials).all()).toHaveLength(0);
  });
});

describe("FORM-06 custom fields and FORM-07 hidden fields", () => {
  it("FORM-06 saves every field type privately, tags the dropdown choice and upserts the customer", async () => {
    makeForm({ hiddenFields: ["utm_source"], autoTags: ["saas-form"] });
    const v3 = await upload();
    const { res, body } = await send(
      minimal({
        answers: [{ key: "q1", text: "Good" }, { key: "q3", ...v3 }],
        person: { name: "Ada", email: "ADA@example.com", phone: "+44 1234", socials: { linkedin: "ada" } },
        authorWebsite: "https://ada.example",
        customFields: { plan: "Enterprise", role_note: "Lead", story: "Long", agree_call: true, nps: 10, site: "https://x.example", seats: "40" },
        hiddenFields: { utm_source: "newsletter", other: "dropped" },
      }),
    );
    expect(res.status, JSON.stringify(body)).toBe(201);
    const t = getTestimonial(body.id)!;
    expect(JSON.parse(t.customFields)).toEqual({
      plan: "Enterprise",
      role_note: "Lead",
      story: "Long",
      agree_call: true,
      nps: 10,
      site: "https://x.example",
      seats: 40,
    });
    expect(JSON.parse(t.hiddenFields)).toEqual({ utm_source: "newsletter" });
    expect(t.tags.sort()).toEqual(["enterprise", "saas-form"]);
    expect(t).toMatchObject({ authorWebsite: "https://ada.example", authorPhone: "+44 1234" });
    // Private: none of it reaches public output.
    const pub = JSON.stringify(toPublic(t));
    for (const secret of ["newsletter", "Enterprise", "+44 1234", "ada@example.com"]) expect(pub).not.toContain(secret);
    const customer = getDb().select().from(schema.customers).where(eq(schema.customers.id, t.customerId!)).get()!;
    expect(customer).toMatchObject({ email: "ada@example.com", name: "Ada", website: "https://ada.example" });
  });

  it("FORM-06 refuses a dropdown value the form doesn't offer", async () => {
    makeForm();
    const v3 = await upload();
    const { res } = await send(minimal({ answers: [{ key: "q1", text: "x" }, { key: "q3", ...v3 }], customFields: { plan: "Gold" } }));
    expect(res.status).toBe(400);
  });
});

describe("private feedback and consent", () => {
  it("FORM-03 stores a private answer as feedback and sends the opt-in feedback.created", async () => {
    makeForm();
    const all = hook([]);
    const opted = hook(["feedback.created"]);
    const v3 = await upload();
    const { body } = await send(minimal({ answers: [{ key: "q1", text: "x" }, { key: "q3", ...v3 }], feedback: [{ key: "note", text: "Pricing page is confusing" }] }));
    expect(listFeedback(projectId).map((f) => [f.text, f.testimonialId])).toEqual([["Pricing page is confusing", body.id]]);
    expect(deliveries("feedback.created").map((d) => d.webhookId)).toEqual([opted]);
    expect(deliveries().filter((d) => d.webhookId === all).map((d) => d.event)).toEqual(["testimonial.created"]);
    // Never part of the testimonial itself.
    expect(JSON.stringify(getTestimonial(body.id))).not.toContain("Pricing page");
  });

  it("FORM-10 private consent is stored and can never be approved", async () => {
    makeForm();
    const v3 = await upload();
    const { body } = await send(minimal({ answers: [{ key: "q1", text: "x" }, { key: "q3", ...v3 }], consent: { agreed: true, public: false, scopes: ["ads", "face"] } }));
    const t = getTestimonial(body.id)!;
    expect(t.consentPublic).toBe(false);
    expect(JSON.parse(t.consentScopes)).toEqual(["website", "ads"]);
    expect(() => updateTestimonial(t.id, { status: "approved" })).toThrow(NoPublicConsentError);
  });
});

describe("FORM-10 per-form rules", () => {
  it("FORM-10 a paused form answers 409 with its closed message", async () => {
    const form = makeForm({ closedMessage: "Back in spring." });
    setFormStatus(form.id, "paused");
    const { res, body } = await send(minimal());
    expect(res.status).toBe(409);
    expect(body.error).toBe("Back in spring.");
  });

  it("FORM-10 caps submissions per IP per day", async () => {
    makeForm({ maxPerIpPerDay: 1 }, PAGES.filter((p) => !("key" in p) || p.key !== "q3"));
    expect((await send(minimal(), {}, { ip: "198.51.100.1" })).res.status).toBe(201);
    expect((await send(minimal(), {}, { ip: "198.51.100.1" })).res.status).toBe(429);
    expect((await send(minimal(), {}, { ip: "198.51.100.2" })).res.status).toBe(201);
  });

  it("FORM-10 the honeypot is accepted and stores nothing", async () => {
    makeForm();
    const { res, body } = await send(minimal(), {}, { extra: { website: "http://spam.example" } });
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(getDb().select().from(schema.testimonials).all()).toHaveLength(0);
  });

  it.each([
    ["all", { mode: "all" }, minimal({ rating: 2 })],
    ["rating", { mode: "rating", minRating: 5 }, minimal({ rating: 5 })],
    ["text", { mode: "text" }, minimal({ rating: 1 })],
    ["public", { mode: "public" }, minimal({ rating: undefined })],
  ] as const)("FORM-10 auto-approve rule %s approves with approvedBy auto", async (_name, rule, payload) => {
    makeForm({ autoApprove: { mode: rule.mode, minRating: ("minRating" in rule ? rule.minRating : 4) as 4 | 5, includeVideo: false, since: null } }, PAGES.filter((p) => !("key" in p) || p.key !== "q3"));
    hook(["testimonial.approved"]);
    const { body } = await send(payload);
    expect(getTestimonial(body.id)).toMatchObject({ status: "approved", approvedBy: "auto" });
    const [d] = deliveries("testimonial.approved");
    expect(JSON.parse(d.payload).data.approvedBy).toBe("auto");
  });

  it("FORM-10 a rating below the rule stays pending", async () => {
    makeForm({ autoApprove: { mode: "rating", minRating: 5, includeVideo: false, since: null } }, PAGES.filter((p) => !("key" in p) || p.key !== "q3"));
    const { body } = await send(minimal({ rating: 4 }));
    expect(getTestimonial(body.id)?.status).toBe("pending");
  });

  it("FORM-10 form.submitted reaches subscribed hooks only, and a form-scoped hook only its form", async () => {
    const saas = makeForm({}, PAGES.filter((p) => !("key" in p) || p.key !== "q3"));
    const other = createForm(projectId, { name: "Other", slug: "other" });
    const catchAll = hook([]);
    const subscribed = hook(["form.submitted"]);
    const scoped = hook(["form.submitted", "testimonial.created"], other.id);
    await send(minimal());
    expect(deliveries("form.submitted").map((d) => d.webhookId)).toEqual([subscribed]);
    expect(deliveries().filter((d) => d.webhookId === scoped)).toHaveLength(0);
    expect(deliveries().filter((d) => d.webhookId === catchAll).map((d) => d.event)).toEqual(["testimonial.created"]);
    const body = JSON.parse(deliveries("form.submitted")[0].payload);
    expect(body.data.form).toMatchObject({ id: saas.id, slug: "saas" });
    await send({ ...minimal(), answers: [{ key: "q1", text: "Other form" }] }, {}, { slug: "other" });
    expect(deliveries().filter((d) => d.webhookId === scoped).map((d) => d.event).sort()).toEqual(["form.submitted", "testimonial.created"]);
  });

  it("FORM-10 the receipt email goes only to request-link submissions, with the form's template", async () => {
    process.env.MAIL_OUTBOX = "true";
    const form = makeForm({ confirmationEmail: { enabled: true, subject: "Thanks from {project}", body: "Cheers! {link}" } }, PAGES.filter((p) => !("key" in p) || p.key !== "q3"));
    const thankYous = () => getDb().select().from(schema.jobs).all().filter((j) => j.type === THANK_YOU_JOB);
    await send(minimal({ person: { name: "Open", email: "open@example.com" } }));
    expect(thankYous()).toHaveLength(0);
    const [r] = createRequests(getProjectById(projectId)!, [{ email: "invited@example.com", name: "Iv" }], { send: false, formId: form.id }).created;
    await send(minimal({ requestToken: requestToken(r.id) }));
    const jobs = thankYous();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload)).toMatchObject({ to: "invited@example.com", formId: form.id });
    expect(getDb().select().from(schema.requests).where(eq(schema.requests.id, r.id)).get()?.status).toBe("responded");
  });
});

describe("the classic endpoint", () => {
  it("FORM-01 still answers as before, now through the default form", async () => {
    const res = await legacyRoute(
      submitRequest("acme", submissionForm({ name: "Ada", consent: "on", text: "Classic", consentSocial: "on", video: new File([WEBM_BYTES], "c.webm", { type: "video/webm" }) })),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["id", "message", "ok", "thankYou", "withdrawUrl"]);
    expect(body.message).toBe(getProjectById(projectId)!.thankYouMessage);
    const t = getTestimonial(body.id)!;
    expect(t).toMatchObject({ text: "Classic", formId: getDefaultForm(projectId).id, source: "form" });
    expect(t.videoKey).toMatch(/^videos\//);
    expect(JSON.parse(t.consentScopes)).toEqual(["website", "social"]);
  });

  it("FORM-10 a paused classic form refuses the classic endpoint", async () => {
    setFormStatus(getDefaultForm(projectId).id, "paused");
    const res = await legacyRoute(submitRequest("acme", submissionForm({ name: "Ada", consent: "on", text: "x" })), params({ slug: "acme" }));
    expect(res.status).toBe(409);
  });
});
