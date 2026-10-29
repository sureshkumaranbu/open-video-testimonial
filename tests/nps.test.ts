import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { GET as npsRoute } from "@/app/api/admin/projects/[id]/nps/route";
import { POST as createFormRoute } from "@/app/api/admin/projects/[id]/forms/route";
import { POST as surveyDraftRoute } from "@/app/api/admin/projects/[id]/survey-draft/route";
import { POST as teamInvite } from "@/app/api/admin/team/route";
import { POST as submitRoute } from "@/app/api/projects/[slug]/forms/[form]/submissions/route";
import { setAiStub, type AiRequest } from "@/lib/ai";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { listAudit } from "@/lib/audit";
import { listFeedback } from "@/lib/feedback";
import { createForm, getForm, setDefaultForm, updateForm } from "@/lib/forms";
import { emptyAnswers, promoterOffer, validateStep, visiblePages } from "@/lib/forms/engine";
import { resolveLabels } from "@/lib/forms/labels";
import { formPagesSchema, parseFormRow, toPublicForm, type FormPage } from "@/lib/forms/schema";
import { surveyPages } from "@/lib/forms/survey";
import { npsScore, npsSummary } from "@/lib/insights/nps";
import { vocReport, insightFiltersSchema } from "@/lib/insights/voc";
import { resetRateLimits } from "@/lib/rate-limit";
import { createProject, getTestimonial } from "@/lib/testimonials";
import { ADMIN_EMAIL, adminHeaders, formSubmission, params, submitFormRequest, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetRateLimits();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  setAiStub(null);
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

function req(url: string, init: { method?: string; json?: unknown; email?: string } = {}) {
  const headers: Record<string, string> = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
  headers.cookie = !init.email || init.email === ADMIN_EMAIL ? adminHeaders().cookie : `${sessionCookieName()}=${createSessionToken(init.email)}`;
  return new Request(`http://localhost${url}`, { method: init.method ?? (init.json === undefined ? "GET" : "POST"), headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
}

let ip = 10;
const send = (slug: string, payload: object) => submitRoute(submitFormRequest("acme", slug, formSubmission(payload), `203.0.113.${ip++}`), params({ slug: "acme", form: slug }));

function survey(questions = ["What could we do better?"]) {
  return createForm(projectId, { name: "Customer survey", kind: "survey", config: { pages: surveyPages("Acme", { questions }) } });
}

const PERSON = { name: "Pat Promoter", email: "pat@example.com" };
const CONSENT = { agreed: true, public: true, scopes: [] };

describe("NPS-01 the NPS question in the forms engine", () => {
  it("NPS-01 is a page of its own: 0–10 then why, at most one per form, with a key no other question shares", () => {
    const pages = surveyPages("Acme");
    const nps = pages.find((p) => p.type === "nps")!;
    expect(nps).toMatchObject({ key: "nps", title: "How likely are you to recommend Acme to a friend or colleague?", required: true, offerTestimonial: true, whyTitle: "" });
    expect(formPagesSchema.safeParse([...pages, { ...nps, key: "nps2" }]).error?.issues[0].message).toBe("A form can have one NPS question");
    expect(formPagesSchema.safeParse(pages.map((p) => (p.type === "feedback" ? { ...p, key: "nps" } : p))).error?.issues[0].message).toMatch(/share the key "nps"/);
    const labels = resolveLabels("en");
    const state = emptyAnswers({ pages });
    expect(state.nps).toEqual({ nps: { score: null, why: "" } });
    expect(validateStep(nps, state, labels)).toEqual({ "n:nps": "Please pick a score from 0 to 10" });
    expect(validateStep(nps, { ...state, nps: { nps: { score: 0, why: "" } } }, labels)).toEqual({});
  });

  it("NPS-01 a survey shows its survey pages to everyone, and the testimonial step only to a promoter who says yes (the low-rating branch in reverse)", () => {
    const cfg = { pages: surveyPages("Acme"), kind: "survey" as const };
    const types = (st: Parameters<typeof visiblePages>[1]) => visiblePages(cfg, st).map((p) => p.type);
    const base = { rating: 0, optIn: false };
    expect(types({ ...base, nps: { nps: { score: 6, why: "" } } })).toEqual(["nps", "feedback"]);
    expect(types({ ...base, nps: { nps: { score: 10, why: "" } } })).toEqual(["nps", "feedback"]);
    expect(types({ rating: 0, optIn: true, nps: { nps: { score: 10, why: "" } } })).toEqual(["nps", "feedback", "question", "consent", "about_you"]);
    // 8 is a passive: no offer, even with the yes still set from before.
    expect(types({ rating: 0, optIn: true, nps: { nps: { score: 8, why: "" } } })).toEqual(["nps", "feedback"]);
    expect(promoterOffer(cfg, { nps: { score: 9 } })).toBe(true);
    // The offer can be turned off; a testimonial form never branches on NPS.
    const off = { ...cfg, pages: cfg.pages.map((p): FormPage => (p.type === "nps" ? { ...p, offerTestimonial: false } : p)) };
    expect(promoterOffer(off, { nps: { score: 10 } })).toBe(false);
    expect(visiblePages({ pages: cfg.pages, kind: "testimonial" }, { ...base, nps: { nps: { score: 2, why: "" } } }).map((p) => p.type)).toContain("question");
  });

  it("NPS-01 a survey stores a non-promoter's answer privately: no testimonial, the score in survey_responses, private questions as feedback", async () => {
    const form = survey();
    const res = await send(form.slug, { nps: [{ key: "nps", score: 6, why: "  Setup was slow. " }], feedback: [{ key: "survey_1", text: "Faster imports" }], answers: [{ key: "q1", text: "sneaky" }], person: PERSON, consent: CONSENT });
    // Paused until published.
    expect(res.status).toBe(409);
    updateForm(form.id, {});
    getDb().update(schema.forms).set({ status: "live" }).where(eq(schema.forms.id, form.id)).run();
    const ok = await send(form.slug, { nps: [{ key: "nps", score: 6, why: "  Setup was slow. " }], feedback: [{ key: "survey_1", text: "Faster imports" }], answers: [{ key: "q1", text: "sneaky" }], person: PERSON, consent: CONSENT });
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body).toMatchObject({ ok: true, feedbackOnly: true, withdrawUrl: null, thankYou: { title: "Thank you!", message: "Your answers help Acme get better." } });
    expect(getDb().select().from(schema.testimonials).all()).toHaveLength(0);
    const rows = getDb().select().from(schema.surveyResponses).all();
    expect(rows).toEqual([expect.objectContaining({ projectId, formId: form.id, testimonialId: null, questionKey: "nps", score: 6, comment: "Setup was slow.", authorName: null, authorEmail: null })]);
    expect(listFeedback(projectId)).toEqual([expect.objectContaining({ source: "survey", text: "Faster imports", testimonialId: null, authorEmail: null })]);
    // A promoter who says yes with a score that isn't one is treated the same: still no testimonial.
    expect((await send(form.slug, { nps: [{ key: "nps", score: 7 }], optIn: true, answers: [{ key: "q1", text: "Hi" }], person: PERSON, consent: CONSENT })).status).toBe(201);
    expect(getDb().select().from(schema.testimonials).all()).toHaveLength(0);
    // The score is required.
    const missing = await send(form.slug, { feedback: [{ key: "survey_1", text: "x" }] });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/Please pick a score/);
  });

  it("NPS-01 a promoter who opts in goes through the whole testimonial pipeline, and the answer is linked to the testimonial", async () => {
    const form = survey();
    getDb().update(schema.forms).set({ status: "live" }).where(eq(schema.forms.id, form.id)).run();
    const res = await send(form.slug, { nps: [{ key: "nps", score: 10, why: "It just works" }], optIn: true, answers: [{ key: "q1", text: "Acme saved us hours every week." }], person: PERSON, consent: CONSENT });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.feedbackOnly).toBeUndefined();
    expect(body.withdrawUrl).toMatch(/\/w\/[\w-]+$/);
    const t = getTestimonial(body.id)!;
    expect(t).toMatchObject({ authorName: "Pat Promoter", text: "Acme saved us hours every week.", formId: form.id, status: "pending" });
    expect(getDb().select().from(schema.surveyResponses).all()).toEqual([expect.objectContaining({ testimonialId: t.id, score: 10, comment: "It just works", authorName: "Pat Promoter", authorEmail: "pat@example.com" })]);
    // Without the main question's answer it's refused like any testimonial.
    expect((await send(form.slug, { nps: [{ key: "nps", score: 9 }], optIn: true, person: PERSON, consent: CONSENT })).status).toBe(400);
  });

  it("NPS-01 an NPS question on a testimonial form is stored with the testimonial; the public form shows the page, never the rules", async () => {
    const form = createForm(projectId, { name: "With NPS" });
    const cfg = parseFormRow(form);
    const pages = [...cfg.pages];
    pages.splice(1, 0, { type: "nps", key: "nps", enabled: true, required: true, title: "Recommend us?", whyTitle: "", offerTestimonial: true, offerTitle: "" });
    updateForm(form.id, { pages });
    const res = await send(form.slug, { nps: [{ key: "nps", score: 3, why: "Pricey" }, { key: "other", score: 1 }], answers: [{ key: "q1", text: "Good tool." }], person: PERSON, consent: CONSENT });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(getDb().select().from(schema.surveyResponses).all()).toEqual([expect.objectContaining({ testimonialId: id, questionKey: "nps", score: 3, comment: "Pricey" })]);
    expect((await send(form.slug, { answers: [{ key: "q1", text: "No score" }], person: PERSON, consent: CONSENT })).status).toBe(400);
    const pub = toPublicForm(getForm(form.id)!, parseFormRow(getForm(form.id)!));
    expect(pub.kind).toBe("testimonial");
    expect(pub.pages.find((p) => p.type === "nps")).toMatchObject({ title: "Recommend us?" });
  });
});

describe("NPS-01 the NPS dashboard", () => {
  it("NPS-01 scores promoters minus detractors, with a trend and the latest comments", async () => {
    expect(npsScore([])).toBeNull();
    expect(npsScore([10, 9, 8, 7, 6, 0])).toBe(0);
    expect(npsScore([10, 10, 10, 2])).toBe(50);
    const form = survey();
    getDb().update(schema.forms).set({ status: "live" }).where(eq(schema.forms.id, form.id)).run();
    for (const [score, why] of [[10, "Love the widget"], [9, ""], [7, "Fine"], [3, "Too expensive"], [0, "Crashes"]] as const) {
      expect((await send(form.slug, { nps: [{ key: "nps", score, why }] })).status).toBe(201);
    }
    getDb().update(schema.surveyResponses).set({ createdAt: new Date("2026-01-05T10:00:00Z") }).where(eq(schema.surveyResponses.score, 0)).run();
    const all = npsSummary(projectId, {});
    expect(all).toMatchObject({ responses: 5, promoters: 2, passives: 1, detractors: 2, score: 0 });
    expect(all.distribution.find((d) => d.value === 10)?.count).toBe(1);
    expect(all.trend.by).toBe("week");
    expect(all.trend.points[0]).toEqual({ period: "2026-01-05", responses: 1, score: -100 });
    expect(all.comments.map((c) => c.comment)).toEqual(["Too expensive", "Fine", "Love the widget", "Crashes"]);
    expect(all.comments[0]).toMatchObject({ group: "detractor", form: "Customer survey" });
    const recent = npsSummary(projectId, { from: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10) });
    expect(recent).toMatchObject({ responses: 4, score: 25, trend: { by: "day" } });

    // Viewers may look; the comments feed Voice of Customer's survey source too.
    process.env.PLAUDIT_FEATURES = "all";
    expect((await teamInvite(req("/api/admin/team", { json: { email: "vera@team.example", role: "viewer", projectIds: null } }))).status).toBe(201);
    const res = await npsRoute(req(`/api/admin/projects/${projectId}/nps?formId=${form.id}`, { email: "vera@team.example" }), params({ id: projectId }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary.responses).toBe(5);
    expect(json.forms).toEqual([expect.objectContaining({ id: form.id, kind: "survey" })]);
    expect((await npsRoute(req(`/api/admin/projects/${projectId}/nps?from=soon`), params({ id: projectId }))).status).toBe(400);
    const voc = vocReport(projectId, insightFiltersSchema.parse({ source: "survey" }));
    expect(voc.breakdown).toMatchObject({ count: 4, sentiment: { positive: 1, neutral: 1, negative: 2 } });
  });
});

describe("NPS-01 surveys and AI surveys", () => {
  it("NPS-01 a new survey is made paused, from its questions, and can't become the default form", async () => {
    const res = await createFormRoute(req(`/api/admin/projects/${projectId}/forms`, { json: { name: "Churn survey", kind: "survey", survey: { npsTitle: "Would you recommend Acme?", questions: ["Why did you stop?", "What would bring you back?"] } } }), params({ id: projectId }));
    expect(res.status).toBe(201);
    const { form } = await res.json();
    expect(form).toMatchObject({ kind: "survey", status: "paused", template: null });
    expect(form.config.pages.map((p: FormPage) => p.type)).toEqual(["welcome", "nps", "feedback", "feedback", "question", "consent", "about_you", "review", "thank_you"]);
    expect(form.config.pages[1].title).toBe("Would you recommend Acme?");
    expect(() => setDefaultForm(projectId, form.id)).toThrow(/can't be the default/);
    expect(listAudit({ projectId }, { limit: 5, offset: 0 }).rows[0].action).toBe("form.survey_create");
    const tooMany = await createFormRoute(req(`/api/admin/projects/${projectId}/forms`, { json: { name: "x", kind: "survey", survey: { questions: ["1", "2", "3", "4", "5", "6"] } } }), params({ id: projectId }));
    expect(tooMany.status).toBe(400);
  });

  it("NPS-01 with AI on, the goal (and only the goal) drafts the questions; with AI off it says so", async () => {
    const off = await surveyDraftRoute(req(`/api/admin/projects/${projectId}/survey-draft`, { json: { goal: "Why trials don't convert" } }), params({ id: projectId }));
    expect(off.status).toBe(409);
    const sent: AiRequest[] = [];
    setAiStub((r) => {
      sent.push(r);
      return { name: "Trial survey", npsTitle: "How likely are you to recommend Acme?", questions: ["What almost stopped you?", "", "What would you change first?", null, "a", "b", "c", "d"] };
    });
    const res = await surveyDraftRoute(req(`/api/admin/projects/${projectId}/survey-draft`, { json: { goal: "Why trials don't convert" } }), params({ id: projectId }));
    expect(res.status).toBe(200);
    expect((await res.json()).draft).toEqual({ name: "Trial survey", npsTitle: "How likely are you to recommend Acme?", questions: ["What almost stopped you?", "What would you change first?", "a", "b", "c"] });
    expect(sent[0].user).toBe("Business: Acme\nGoal: Why trials don't convert");
    expect((await surveyDraftRoute(req(`/api/admin/projects/${projectId}/survey-draft`, { json: { goal: "" } }), params({ id: projectId }))).status).toBe(400);
    expect(listAudit({ projectId }, { limit: 5, offset: 0 }).rows[0].action).toBe("form.survey_ai_draft");
    process.env.PLAUDIT_FEATURES = "all";
    expect((await teamInvite(req("/api/admin/team", { json: { email: "vera@team.example", role: "viewer", projectIds: null } }))).status).toBe(201);
    expect((await surveyDraftRoute(req(`/api/admin/projects/${projectId}/survey-draft`, { json: { goal: "x y z" }, email: "vera@team.example" }), params({ id: projectId }))).status).toBe(403);
  });
});
