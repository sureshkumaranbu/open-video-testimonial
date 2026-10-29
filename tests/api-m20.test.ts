import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createKeyRoute } from "@/app/api/admin/api-keys/route";
import { GET as getCaseStudyRoute, PATCH as patchCaseStudy } from "@/app/api/v1/case-studies/[id]/route";
import { GET as getReportRoute } from "@/app/api/v1/insight-reports/[id]/route";
import { GET as listCaseStudiesRoute, POST as createCaseStudyRoute } from "@/app/api/v1/projects/[slug]/case-studies/route";
import { GET as listReportsRoute } from "@/app/api/v1/projects/[slug]/insight-reports/route";
import { GET as npsRoute } from "@/app/api/v1/projects/[slug]/nps/route";
import { GET as surveyRoute } from "@/app/api/v1/projects/[slug]/survey-responses/route";
import { GET as getDraftRoute, PATCH as patchDraft } from "@/app/api/v1/testimonials/[id]/social-draft/route";
import { POST as mcpPost } from "@/app/mcp/route";
import { getDb, schema } from "@/db";
import { listAudit } from "@/lib/audit";
import { getSocialDraft } from "@/lib/commerce/social";
import { createForm } from "@/lib/forms";
import { saveReport } from "@/lib/insights/reports";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { createWebhook } from "@/lib/webhook-admin";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

/** L23, L25: case studies, NPS, saved reports and social drafts in /api/v1 and MCP, with the dashboard's checks. */

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let read: string;
let write: string;

async function newKey(scope: "read" | "write", projectIds?: string[]) {
  const res = await createKeyRoute(
    new Request("http://localhost/api/admin/api-keys", { method: "POST", body: JSON.stringify({ name: `${scope} key`, scope, projectIds }), headers: { ...adminHeaders(), "content-type": "application/json" } }),
  );
  return ((await res.json()) as { key: string }).key;
}

const call = (key: string, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost/api/v1${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } });
const json = async (res: Response | Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
const slug = params({ slug: "acme" });

beforeEach(async () => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  read = await newKey("read");
  write = await newKey("write");
});
afterEach(() => {
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

function approved(name = "Ada", text = "Acme saved us 40% of our week.") {
  const t = createTestimonial(projectId, { name, email: `${name.toLowerCase()}@example.com`, company: `${name} Co`, text, consentPublic: true }, { source: "api" });
  updateTestimonial(t.id, { status: "approved" }, { quiet: true });
  return t;
}

describe("API-01 SHARE-04 case studies", () => {
  it("API-01 SHARE-04 L23 lists, starts from a testimonial, reads and changes case studies as the editor does, in the audit log", async () => {
    const t = approved();
    expect((await json(listCaseStudiesRoute(call(read, "/projects/acme/case-studies"), slug))).body).toEqual({ data: [] });
    expect((await createCaseStudyRoute(call(read, "/projects/acme/case-studies", { testimonialId: t.id }), slug)).status).toBe(403);
    expect((await json(createCaseStudyRoute(call(write, "/projects/acme/case-studies", {}), slug))).body).toEqual({ error: "Choose the testimonial" });

    const made = await json(createCaseStudyRoute(call(write, "/projects/acme/case-studies", { testimonialId: t.id }), slug));
    expect(made.status).toBe(201);
    const cs = made.body.data;
    expect(cs).toMatchObject({ projectId, testimonialId: t.id, status: "draft", title: "Ada Co and Acme", person: { name: "Ada", company: "Ada Co" }, publicUrl: null });
    expect(cs.content.pullQuote).toBe("Acme saved us 40% of our week.");

    const id = params({ id: cs.id });
    expect((await json(getCaseStudyRoute(call(read, `/case-studies/${cs.id}`), id))).body.data.id).toBe(cs.id);
    const patched = await json(patchCaseStudy(call(write, `/case-studies/${cs.id}`, { status: "published", content: { result: "A shorter week.", metrics: [{ value: "40%", label: "time saved" }] } }, "PATCH"), id));
    expect(patched.status).toBe(200);
    // Fields left out keep their values.
    expect(patched.body.data).toMatchObject({ status: "published", title: "Ada Co and Acme", publicUrl: `http://localhost:3000/cs/${cs.id}`, content: { pullQuote: "Acme saved us 40% of our week.", result: "A shorter week." } });
    expect((await json(patchCaseStudy(call(write, `/case-studies/${cs.id}`, { title: "" }, "PATCH"), id))).body).toEqual({ error: "Give the case study a title" });
    expect((await patchCaseStudy(call(write, `/case-studies/${cs.id}`, { aiDrafted: true }, "PATCH"), id)).status).toBe(400);
    expect((await patchCaseStudy(call(read, `/case-studies/${cs.id}`, { title: "x" }, "PATCH"), id)).status).toBe(403);
    expect(listAudit({}, { limit: 50, offset: 0 }).rows.map((e) => e.action)).toEqual(expect.arrayContaining(["case_study.create", "case_study.publish"]));

    // A testimonial in the trash, or in a project the key can't reach, is refused.
    const trashed = approved("Bo");
    updateTestimonial(trashed.id, { status: "trashed" }, { quiet: true });
    expect((await createCaseStudyRoute(call(write, "/projects/acme/case-studies", { testimonialId: trashed.id }), slug)).status).toBe(409);
    const other = createProject({ name: "Other", slug: "other" });
    const limited = await newKey("write", [other.id]);
    expect((await getCaseStudyRoute(call(limited, `/case-studies/${cs.id}`), id)).status).toBe(404);
    expect((await listCaseStudiesRoute(call(limited, "/projects/acme/case-studies"), slug)).status).toBe(404);
  });

  it("API-01 SHARE-04 L23 the paths answer 404 with the insights flag off (or api2)", async () => {
    process.env.PLAUDIT_FEATURES = "forms,api2,mcp,commerce";
    expect((await listCaseStudiesRoute(call(read, "/projects/acme/case-studies"), slug)).status).toBe(404);
    expect((await npsRoute(call(read, "/projects/acme/nps"), slug)).status).toBe(404);
    expect((await listReportsRoute(call(read, "/projects/acme/insight-reports"), slug)).status).toBe(404);
    process.env.PLAUDIT_FEATURES = "forms,insights";
    expect((await surveyRoute(call(read, "/projects/acme/survey-responses"), slug)).status).toBe(404);
  });
});

describe("API-01 NPS-01 VOC-01 NPS and saved reports (read only)", () => {
  it("API-01 NPS-01 L23 the NPS summary and every answer, paged and by form; private answers keep their email in the API", async () => {
    const survey = createForm(projectId, { name: "Survey", kind: "survey" });
    const add = (score: number, comment: string | null, formId: string | null, at: string) =>
      getDb().insert(schema.surveyResponses).values({ id: crypto.randomUUID(), projectId, formId, questionKey: "nps", score, comment, authorName: "Pat", authorEmail: "pat@example.com", createdAt: new Date(at) }).run();
    add(10, "Love it", survey.id, "2026-10-01T10:00:00Z");
    add(9, null, survey.id, "2026-10-02T10:00:00Z");
    add(3, "Too slow", null, "2026-10-03T10:00:00Z");

    const nps = await json(npsRoute(call(read, "/projects/acme/nps"), slug));
    expect(nps.body.data).toMatchObject({ responses: 3, score: 33, promoters: 2, passives: 0, detractors: 1 });
    expect(JSON.stringify(nps.body.data.comments)).not.toContain("@");
    expect((await json(npsRoute(call(read, `/projects/acme/nps?formId=${survey.id}&from=2026-10-02`), slug))).body.data).toMatchObject({ responses: 1, score: 100 });
    expect((await json(npsRoute(call(read, "/projects/acme/nps?from=yesterday"), slug))).body).toEqual({ error: "Use dates like 2026-01-31" });

    const page = await json(surveyRoute(call(read, "/projects/acme/survey-responses?limit=2"), slug));
    expect(page.body.data.map((r: { score: number }) => r.score)).toEqual([3, 9]);
    expect(page.body.data[0]).toMatchObject({ category: "detractor", comment: "Too slow", formId: null, author: { name: "Pat", email: "pat@example.com" } });
    expect(page.body.pagination).toEqual({ total: 3, limit: 2, offset: 0, nextOffset: 2 });
    expect((await json(surveyRoute(call(read, `/projects/acme/survey-responses?formId=${survey.id}`), slug))).body.data).toHaveLength(2);
  });

  it("API-01 VOC-01 L23 saved reports: listed without their results, read with them", async () => {
    const r = saveReport(projectId, { kind: "voc", name: "October", params: { from: "2026-10-01" }, result: { breakdown: { count: 3 } } }, "owner@example.com");
    const list = await json(listReportsRoute(call(read, "/projects/acme/insight-reports"), slug));
    expect(list.body.data).toEqual([{ id: r.id, kind: "voc", name: "October", params: { from: "2026-10-01" }, createdBy: "owner@example.com", createdAt: r.createdAt.toISOString() }]);
    const one = await json(getReportRoute(call(read, `/insight-reports/${r.id}`), params({ id: r.id })));
    expect(one.body.data.result).toEqual({ breakdown: { count: 3 } });
    const other = createProject({ name: "Other", slug: "other" });
    const limited = await newKey("read", [other.id]);
    expect((await getReportRoute(call(limited, `/insight-reports/${r.id}`), params({ id: r.id }))).status).toBe(404);
  });
});

describe("API-01 INT-08 social drafts", () => {
  it("API-01 INT-08 L25 reads an approved testimonial's draft and saves new text, sending testimonial.social_draft_updated", async () => {
    createWebhook({ url: "https://hooks.example/drafts", events: ["testimonial.social_draft_updated"], projectId: null, formId: null, active: true });
    const pending = createTestimonial(projectId, { name: "Cy", text: "Nice" }, { source: "api" });
    expect((await json(getDraftRoute(call(read, `/testimonials/${pending.id}/social-draft`), params({ id: pending.id })))).body).toEqual({ error: "A social post draft is made once the testimonial is approved" });

    const t = approved();
    const id = params({ id: t.id });
    const got = await json(getDraftRoute(call(read, `/testimonials/${t.id}/social-draft`), id));
    expect(got.body.data).toMatchObject({ testimonialId: t.id, text: expect.stringMatching(/^“Acme saved us 40%/), url: `http://localhost:3000/t/${t.id}`, edited: false });

    expect((await patchDraft(call(read, `/testimonials/${t.id}/social-draft`, { text: "Hi" }, "PATCH"), id)).status).toBe(403);
    expect((await patchDraft(call(write, `/testimonials/${t.id}/social-draft`, { text: "x".repeat(300) }, "PATCH"), id)).status).toBe(400);
    const saved = await json(patchDraft(call(write, `/testimonials/${t.id}/social-draft`, { text: "40% of a week back. Thanks, Ada!" }, "PATCH"), id));
    expect(saved.body.data).toMatchObject({ text: "40% of a week back. Thanks, Ada!", edited: true, post: `40% of a week back. Thanks, Ada!\n\nhttp://localhost:3000/t/${t.id}` });
    expect(getSocialDraft(t.id)!.editedBy).toMatch(/^API key “write key”/);
    const [delivery] = getDb().select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.event, "testimonial.social_draft_updated")).all();
    expect(JSON.parse(delivery.payload).data.socialDraft.text).toBe("40% of a week back. Thanks, Ada!");

    process.env.PLAUDIT_FEATURES = "forms,api2,insights";
    expect((await getDraftRoute(call(read, `/testimonials/${t.id}/social-draft`), id)).status).toBe(404);
  });
});

// ------------------------------------------------------------------ MCP

let nextId = 1;
async function tool(key: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcpPost(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${key}` },
    }),
  );
  return (await res.json()).result as { isError?: boolean; structuredContent?: any; content: { text: string }[] };
}
async function toolNames(key: string) {
  const res = await mcpPost(new Request("http://localhost:3000/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/list" }), headers: { "content-type": "application/json", authorization: `Bearer ${key}` } }));
  return ((await res.json()).result.tools as { name: string }[]).map((t) => t.name);
}

describe("INT-04 MCP tools for M17 and M18", () => {
  it("INT-04 SHARE-04 L23 a write key starts and changes a case study; a read key only reads it", async () => {
    const t = approved();
    expect(await toolNames(read)).not.toContain("create_case_study");
    expect(await toolNames(write)).toEqual(expect.arrayContaining(["create_case_study", "update_case_study", "update_social_draft"]));
    expect((await tool(read, "create_case_study", { testimonialId: t.id })).content[0].text).toMatch(/^create_case_study needs write access/);
    const made = (await tool(write, "create_case_study", { testimonialId: t.id })).structuredContent;
    expect(made).toMatchObject({ testimonialId: t.id, status: "draft" });
    const changed = (await tool(write, "update_case_study", { id: made.id, content: { challenge: "Too many spreadsheets." } })).structuredContent;
    expect(changed.content).toMatchObject({ challenge: "Too many spreadsheets.", pullQuote: "Acme saved us 40% of our week." });
    expect((await tool(read, "list_case_studies")).structuredContent.caseStudies).toEqual([expect.objectContaining({ id: made.id, title: "Ada Co and Acme" })]);
    expect((await tool(read, "get_case_study", { id: made.id })).structuredContent.content.challenge).toBe("Too many spreadsheets.");
    expect((await tool(read, "get_case_study", { id: "nope" })).isError).toBe(true);
    expect(listAudit({}, { limit: 50, offset: 0 }).rows.find((e) => e.action === "case_study.update")).toMatchObject({ actorType: "api_key" });
  });

  it("INT-04 NPS-01 VOC-01 L23 nps_summary and list_survey_responses never show an email; saved reports are readable", async () => {
    getDb().insert(schema.surveyResponses).values({ id: crypto.randomUUID(), projectId, questionKey: "nps", score: 6, comment: "Pricey", authorName: "Pat", authorEmail: "pat@example.com", createdAt: new Date() }).run();
    const nps = (await tool(read, "nps_summary")).structuredContent;
    expect(nps).toMatchObject({ project: { slug: "acme" }, responses: 1, score: -100, detractors: 1 });
    const answers = (await tool(read, "list_survey_responses")).structuredContent;
    expect(answers.responses).toEqual([expect.objectContaining({ score: 6, category: "detractor", comment: "Pricey", name: "Pat" })]);
    expect(JSON.stringify(answers) + JSON.stringify(nps)).not.toContain("pat@example.com");
    const r = saveReport(projectId, { kind: "ask", name: "Why", result: { answer: "Speed" } });
    expect((await tool(read, "list_insight_reports")).structuredContent.reports).toEqual([expect.objectContaining({ id: r.id, name: "Why" })]);
    expect((await tool(read, "get_insight_report", { id: r.id })).structuredContent.result).toEqual({ answer: "Speed" });
  });

  it("INT-04 INT-08 L25 get_social_draft and update_social_draft, and the tools go with their flags", async () => {
    const t = approved();
    expect((await tool(read, "get_social_draft", { testimonialId: t.id })).structuredContent).toMatchObject({ testimonialId: t.id, edited: false });
    expect((await tool(read, "update_social_draft", { testimonialId: t.id, text: "Hi" })).isError).toBe(true);
    expect((await tool(write, "update_social_draft", { testimonialId: t.id, text: "Thanks, Ada!" })).structuredContent).toMatchObject({ text: "Thanks, Ada!", edited: true });
    expect(getSocialDraft(t.id)!.text).toBe("Thanks, Ada!");

    process.env.PLAUDIT_FEATURES = "forms,mcp";
    const names = await toolNames(write);
    for (const name of ["list_case_studies", "nps_summary", "get_social_draft", "update_social_draft"]) expect(names).not.toContain(name);
    expect(names).toContain("create_invite");
    const res = await mcpPost(new Request("http://localhost:3000/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nps_summary", arguments: {} } }), headers: { "content-type": "application/json", authorization: `Bearer ${read}` } }));
    expect((await res.json()).error).toMatchObject({ code: -32602 });
  });
});
