import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { POST as draftRoute } from "@/app/api/admin/case-studies/[id]/draft/route";
import { GET as adminPdfRoute } from "@/app/api/admin/case-studies/[id]/pdf/route";
import { DELETE as deleteRoute, GET as getRoute, PUT as putRoute } from "@/app/api/admin/case-studies/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/projects/[id]/case-studies/route";
import { POST as manualRoute } from "@/app/api/admin/projects/[id]/testimonials/manual/route";
import { POST as teamInvite } from "@/app/api/admin/team/route";
import { GET as publicPdfRoute } from "@/app/cs/[id]/pdf/route";
import { setAiStub, type AiRequest } from "@/lib/ai";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { listAudit } from "@/lib/audit";
import { createCaseStudy, draftCaseStudy, getCaseStudy, publicCaseStudy, templateFor, updateCaseStudy } from "@/lib/case-studies";
import { caseStudyPdf, pdfFileName } from "@/lib/case-study-pdf";
import { createProject, createTestimonial, getProjectById, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  setAiStub(null);
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

const STORY =
  "Before Acme we chased customers for reviews by email every week. Within a month we had 40 video testimonials and our demo bookings went up 25%. Honestly the best tool we bought this year.";

function testimonial(o: { approve?: boolean } = {}) {
  const t = createTestimonial(projectId, { name: "Dana Kim", email: "dana@private.example", title: "Head of Growth", company: "Northwind", text: STORY, rating: 5 });
  if (o.approve !== false) updateTestimonial(t.id, { status: "approved" }, { quiet: true });
  return getTestimonial(t.id)!;
}

function req(url: string, init: { method?: string; json?: unknown; email?: string } = {}) {
  const headers: Record<string, string> = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
  headers.cookie = !init.email || init.email === ADMIN_EMAIL ? adminHeaders().cookie : `${sessionCookieName()}=${createSessionToken(init.email)}`;
  return new Request(`http://localhost${url}`, { method: init.method ?? (init.json === undefined ? "GET" : "POST"), headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
}

describe("SHARE-04 case studies without AI", () => {
  it("SHARE-04 starts as a template made from the testimonial: the person, a title and a pull quote from their words", () => {
    const t = testimonial();
    const project = getProjectById(projectId)!;
    const tpl = templateFor(project, t);
    expect(tpl.title).toBe("Northwind and Acme");
    expect(tpl.content.pullQuote).toBe("Before Acme we chased customers for reviews by email every week.");
    expect(tpl.content).toMatchObject({ challenge: "", solution: "", result: "", metrics: [] });
    // A highlighted phrase wins over the first sentence.
    getDb().insert(schema.highlights).values({ id: "h1", testimonialId: t.id, answerId: null, start: 0, end: 10, phrase: "the best tool we bought this year" }).run();
    expect(templateFor(project, t).content.pullQuote).toBe("the best tool we bought this year");
    const cs = createCaseStudy(project, t.id);
    expect(cs.status).toBe("draft");
    expect(cs.aiDraftedAt).toBeNull();
  });

  it("SHARE-04 Draft with AI says AI is off (409) and nothing is sent, on the server or for a project that turned it off", async () => {
    const t = testimonial();
    const cs = createCaseStudy(getProjectById(projectId)!, t.id);
    await expect(draftCaseStudy(cs)).rejects.toMatchObject({ status: 409 });
    const sent: AiRequest[] = [];
    setAiStub((r) => {
      sent.push(r);
      return {};
    });
    getDb().update(schema.projects).set({ aiEnabled: false }).where(eq(schema.projects.id, projectId)).run();
    const res = await draftRoute(req(`/api/admin/case-studies/${cs.id}/draft`, { method: "POST" }), params({ id: cs.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/isn't on for this project/);
    expect(sent).toHaveLength(0);
  });

  it("SHARE-04 is saved with checks, and lists, edits and deletes go through the role guard and the audit log", async () => {
    const t = testimonial();
    const created = await createRoute(req(`/api/admin/projects/${projectId}/case-studies`, { json: { testimonialId: t.id } }), params({ id: projectId }));
    expect(created.status).toBe(201);
    const { caseStudy } = await created.json();
    expect(caseStudy).toMatchObject({ status: "draft", publicUrl: null, canBePublic: true, person: { name: "Dana Kim", company: "Northwind" } });
    // Someone else's testimonial, or none.
    const other = createProject({ name: "Other", slug: "other" });
    const foreign = createTestimonial(other.id, { name: "Eve", text: "Hi" });
    expect((await createRoute(req(`/api/admin/projects/${projectId}/case-studies`, { json: { testimonialId: foreign.id } }), params({ id: projectId }))).status).toBe(404);
    expect((await createRoute(req(`/api/admin/projects/${projectId}/case-studies`, { json: {} }), params({ id: projectId }))).status).toBe(400);

    const content = { summary: "Northwind collects video reviews.", challenge: "Reviews took weeks.", solution: "They sent one link.", result: "40 videos in a month.", pullQuote: "Honestly the best tool we bought this year.", metrics: [{ value: "40", label: "video testimonials in a month" }] };
    const put = await putRoute(req(`/api/admin/case-studies/${caseStudy.id}`, { method: "PUT", json: { title: "How Northwind got 40 videos", content } }), params({ id: caseStudy.id }));
    expect(put.status).toBe(200);
    expect((await put.json()).caseStudy).toMatchObject({ title: "How Northwind got 40 videos", content });
    expect((await putRoute(req(`/api/admin/case-studies/${caseStudy.id}`, { method: "PUT", json: { title: "", content } }), params({ id: caseStudy.id }))).status).toBe(400);
    const tooMany = { ...content, metrics: Array.from({ length: 5 }, () => ({ value: "1", label: "x" })) };
    expect((await putRoute(req(`/api/admin/case-studies/${caseStudy.id}`, { method: "PUT", json: { title: "x", content: tooMany } }), params({ id: caseStudy.id }))).status).toBe(400);

    const list = await (await listRoute(req(`/api/admin/projects/${projectId}/case-studies`), params({ id: projectId }))).json();
    expect(list).toMatchObject({ ai: false, caseStudies: [{ id: caseStudy.id }] });
    expect(list.candidates.map((c: { id: string }) => c.id)).toEqual([t.id]);

    // A viewer reads and downloads, but can't change anything.
    process.env.PLAUDIT_FEATURES = "all";
    expect((await teamInvite(req("/api/admin/team", { json: { email: "vera@team.example", role: "viewer", projectIds: null } }))).status).toBe(201);
    expect((await getRoute(req(`/api/admin/case-studies/${caseStudy.id}`, { email: "vera@team.example" }), params({ id: caseStudy.id }))).status).toBe(200);
    expect((await adminPdfRoute(req(`/api/admin/case-studies/${caseStudy.id}/pdf`, { email: "vera@team.example" }), params({ id: caseStudy.id }))).status).toBe(200);
    expect((await putRoute(req(`/api/admin/case-studies/${caseStudy.id}`, { method: "PUT", json: { title: "x", content }, email: "vera@team.example" }), params({ id: caseStudy.id }))).status).toBe(403);
    expect((await createRoute(req(`/api/admin/projects/${projectId}/case-studies`, { json: { testimonialId: t.id }, email: "vera@team.example" }), params({ id: projectId }))).status).toBe(403);
    expect((await draftRoute(req(`/api/admin/case-studies/${caseStudy.id}/draft`, { method: "POST", email: "vera@team.example" }), params({ id: caseStudy.id }))).status).toBe(403);
    expect((await deleteRoute(req(`/api/admin/case-studies/${caseStudy.id}`, { method: "DELETE", email: "vera@team.example" }), params({ id: caseStudy.id }))).status).toBe(403);

    expect((await deleteRoute(req(`/api/admin/case-studies/${caseStudy.id}`, { method: "DELETE" }), params({ id: caseStudy.id }))).status).toBe(204);
    expect(getCaseStudy(caseStudy.id)).toBeNull();
    const actions = listAudit({ projectId }, { limit: 50, offset: 0 }).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["case_study.create", "case_study.update", "case_study.delete"]));
  });

  it("SHARE-04 the Case study tab of manual add adds the testimonial and makes a case study from it", async () => {
    const form = new FormData();
    form.set("payload", JSON.stringify({ kind: "case_study", name: "Lee Park", company: "Contoso", text: "We cut onboarding from two weeks to three days." }));
    const res = await manualRoute(new Request(`http://localhost/api/admin/projects/${projectId}/testimonials/manual`, { method: "POST", headers: adminHeaders(), body: form }), params({ id: projectId }));
    expect(res.status).toBe(201);
    const { testimonial: t, caseStudy } = await res.json();
    expect(t).toMatchObject({ authorName: "Lee Park", status: "approved", source: "manual" });
    expect(caseStudy).toMatchObject({ testimonialId: t.id, title: "Contoso and Acme", content: { pullQuote: "We cut onboarding from two weeks to three days." } });
    // Like the Text tab, it needs words.
    const empty = new FormData();
    empty.set("payload", JSON.stringify({ kind: "case_study", name: "Lee Park" }));
    expect((await manualRoute(new Request(`http://localhost/x`, { method: "POST", headers: adminHeaders(), body: empty }), params({ id: projectId }))).status).toBe(400);
  });
});

describe("SHARE-04 Draft with AI", () => {
  it("SHARE-04 sends only the testimonial's own words (trimmed), and keeps a pull quote and metrics only when they're really in them", async () => {
    const t = testimonial();
    const cs = createCaseStudy(getProjectById(projectId)!, t.id);
    const sent: AiRequest[] = [];
    setAiStub((r) => {
      sent.push(r);
      return {
        title: "How Northwind collects 40 video testimonials a month",
        summary: "Northwind's growth team stopped chasing reviews.",
        challenge: "They chased customers by email every week.",
        solution: "They switched to Acme.",
        result: "40 videos in a month and 25% more demos.",
        pullQuote: "“Honestly the best tool we bought this year.”",
        metrics: [
          { value: "40", label: "video testimonials in a month" },
          { value: "25%", label: "more demo bookings" },
          { value: "3x", label: "faster everything" },
          "not a metric",
        ],
      };
    });
    const draft = await draftCaseStudy(cs);
    expect(sent).toHaveLength(1);
    expect(sent[0].user).toContain(STORY);
    expect(sent[0].user).toContain("Customer: Dana Kim, Head of Growth, Northwind");
    // Never the email or anything private.
    expect(sent[0].user).not.toContain("dana@private.example");
    expect(sent[0].images).toEqual([]);
    expect(draft.title).toBe("How Northwind collects 40 video testimonials a month");
    expect(draft.content.pullQuote).toBe("Honestly the best tool we bought this year.");
    expect(draft.content.metrics).toEqual([
      { value: "40", label: "video testimonials in a month" },
      { value: "25%", label: "more demo bookings" },
    ]);
    expect(draft.dropped).toEqual([expect.stringMatching(/3x faster everything/)]);
    // Nothing is saved until the editor saves it.
    expect(getCaseStudy(cs.id)!.title).toBe("Northwind and Acme");

    // A made-up quote is swapped for the template's; a broken answer is a 502 that keeps the editor as it was.
    setAiStub(() => ({ title: "T", pullQuote: "Acme changed our lives forever.", metrics: [] }));
    expect((await draftCaseStudy(cs)).content.pullQuote).toBe("Before Acme we chased customers for reviews by email every week.");
    setAiStub(() => "I can't help with that.");
    const res = await draftRoute(req(`/api/admin/case-studies/${cs.id}/draft`, { method: "POST" }), params({ id: cs.id }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/wasn't JSON/);

    // Saving what was drafted records it.
    setAiStub(() => ({ title: "Drafted", pullQuote: "", metrics: [] }));
    const ok = await draftRoute(req(`/api/admin/case-studies/${cs.id}/draft`, { method: "POST" }), params({ id: cs.id }));
    const { draft: d } = await ok.json();
    updateCaseStudy(cs.id, { title: d.title, content: d.content, aiDrafted: true });
    expect(getCaseStudy(cs.id)!.aiDraftedAt).toBeInstanceOf(Date);
    expect(listAudit({ projectId }, { limit: 50, offset: 0 }).rows.map((r) => r.action)).toContain("case_study.ai_draft");
  });
});

describe("SHARE-04 the public page and PDF", () => {
  it("SHARE-04 exist only while published and the testimonial is approved, not withdrawn and public", async () => {
    const t = testimonial();
    const cs = createCaseStudy(getProjectById(projectId)!, t.id);
    const pub = (id = cs.id) => publicPdfRoute(new Request(`http://localhost/cs/${id}/pdf`), params({ id }));
    expect(publicCaseStudy(cs.id)).toBeNull();
    expect((await pub()).status).toBe(404);
    updateCaseStudy(cs.id, { title: "How Northwind got 40 videos", status: "published", content: { pullQuote: "Honestly the best tool we bought this year.", result: "40 videos." } });
    expect(publicCaseStudy(cs.id)).toMatchObject({ title: "How Northwind got 40 videos", item: { name: "Dana Kim", company: "Northwind" } });
    const res = await pub();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("How Northwind got 40 videos");
    expect(doc.getPageCount()).toBe(1);
    // Never the private email, in any form.
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("dana@private.example");

    // The flag off, a rejection, a withdrawal or private consent: gone, like an unknown id.
    process.env.PLAUDIT_FEATURES = "forms";
    expect((await pub()).status).toBe(404);
    delete process.env.PLAUDIT_FEATURES;
    updateTestimonial(t.id, { status: "rejected" }, { quiet: true });
    expect(publicCaseStudy(cs.id)).toBeNull();
    updateTestimonial(t.id, { status: "approved" }, { quiet: true });
    getDb().update(schema.testimonials).set({ withdrawnAt: new Date() }).where(eq(schema.testimonials.id, t.id)).run();
    expect(publicCaseStudy(cs.id)).toBeNull();
    getDb().update(schema.testimonials).set({ withdrawnAt: null, consentPublic: false }).where(eq(schema.testimonials.id, t.id)).run();
    expect(publicCaseStudy(cs.id)).toBeNull();
    expect((await pub("not-a-uuid")).status).toBe(404);
    // Unpublished again: gone too.
    getDb().update(schema.testimonials).set({ consentPublic: true }).where(eq(schema.testimonials.id, t.id)).run();
    expect(publicCaseStudy(cs.id)).not.toBeNull();
    updateCaseStudy(cs.id, { title: "x", status: "draft", content: {} });
    expect(publicCaseStudy(cs.id)).toBeNull();
  });

  it("SHARE-04 the PDF wraps long sections onto more pages and leaves out characters the font can't draw", async () => {
    const t = testimonial();
    const cs = createCaseStudy(getProjectById(projectId)!, t.id);
    const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: ${"Northwind’s team rebuilt how they ask for reviews, one customer at a time. ".repeat(6)}`).join("\n");
    updateCaseStudy(cs.id, {
      title: "Rocket growth 🚀 at Northwind",
      content: { summary: "Supercalifragilisticexpialidocious".repeat(4), challenge: long.slice(0, 2990), solution: long.slice(0, 2900), result: "Done ✅", pullQuote: "Best tool.", metrics: [{ value: "40", label: "videos" }, { value: "25%", label: "more demos" }] },
    });
    const view = (await import("@/lib/case-studies")).caseStudyView(getCaseStudy(cs.id)!)!;
    const bytes = await caseStudyPdf(view);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe("Rocket growth  at Northwind");
    expect(pdfFileName("Rocket growth 🚀 at Northwind!")).toBe("rocket-growth-at-northwind.pdf");
    expect(pdfFileName("🚀")).toBe("case-study.pdf");
  });
});
