import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { GET as reportCsvRoute } from "@/app/api/admin/insight-reports/[id]/csv/route";
import { DELETE as deleteReportRoute, GET as getReportRoute } from "@/app/api/admin/insight-reports/[id]/route";
import { PUT as aiRoute } from "@/app/api/admin/projects/[id]/ai/route";
import { GET as listReportsRoute, POST as saveReportRoute } from "@/app/api/admin/projects/[id]/insight-reports/route";
import { POST as askRoute } from "@/app/api/admin/projects/[id]/insights/ask/route";
import { GET as vocRoute } from "@/app/api/admin/projects/[id]/insights/route";
import { POST as themesRoute } from "@/app/api/admin/projects/[id]/insights/themes/route";
import { POST as teamInvite } from "@/app/api/admin/team/route";
import { setAiStub, type AiRequest } from "@/lib/ai";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { listAudit } from "@/lib/audit";
import { countWords, tokenize } from "@/lib/insights/text";
import { askQuestion, insightFiltersSchema, questionQuery, vocReport, vocThemes } from "@/lib/insights/voc";
import { createProject, createTestimonial, getProjectById, updateTestimonial } from "@/lib/testimonials";
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

const f = (o: object = {}) => insightFiltersSchema.parse(o);

function req(url: string, init: { method?: string; json?: unknown; email?: string } = {}) {
  const headers: Record<string, string> = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
  headers.cookie = !init.email || init.email === ADMIN_EMAIL ? adminHeaders().cookie : `${sessionCookieName()}=${createSessionToken(init.email)}`;
  return new Request(`http://localhost${url}`, { method: init.method ?? (init.json === undefined ? "GET" : "POST"), headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
}

async function invite(email: string, role: "editor" | "viewer") {
  process.env.PLAUDIT_FEATURES = "all";
  expect((await teamInvite(req("/api/admin/team", { json: { email, role, projectIds: null } }))).status).toBe(201);
}

/** A small, realistic inbox: happy customers praise setup and support, unhappy ones the price and the mobile app. */
function seed() {
  const rows: [string, number, string, string[]?][] = [
    ["Maria Gonzalez", 5, "So easy to use. Setup took ten minutes and customer support answered within an hour.", ["pricing"]],
    ["Tom Becker", 5, "Easy to use and the customer support team is lovely.", []],
    ["Ana Silva", 4, "Easy to use, and the video widget looks great on our homepage.", []],
    ["Li Wei", 5, "Customer support fixed our import the same day. Easy to use.", []],
    ["Sam Okafor", 2, "Too expensive for a small team, and the mobile app keeps crashing.", ["pricing"]],
    ["Ines Duarte", 3, "The mobile app is slow. Too expensive for what it does.", []],
    ["Kofi Mensah", 1, "The mobile app crashed twice while recording.", []],
    ["Greta Holm", 4, "Video widget is lovely; customer support was quick.", []],
  ];
  return rows.map(([name, rating, text, tags]) => {
    const t = createTestimonial(projectId, { name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, rating, text, company: "Globex" });
    updateTestimonial(t.id, { status: "approved", ...(tags?.length ? { tags } : {}) }, { quiet: true });
    return t.id;
  });
}

describe("VOC-01 words and phrases without AI", () => {
  it("VOC-01 counts each word and phrase once per testimonial, skipping common words and people's names", () => {
    expect(tokenize("Café's GREAT, easy-to-use!")).toEqual(["cafe", "s", "great", "easy", "to", "use"]);
    const docs = [
      { id: "a", tokens: tokenize("easy to use easy to use, great support"), group: "love" as const },
      { id: "b", tokens: tokenize("Easy to use. Maria loved it"), group: "love" as const },
    ];
    const out = countWords(docs, new Set(["maria"]));
    expect(out.phrases.find((p) => p.label === "easy to use")).toEqual({ label: "easy to use", count: 2, ids: ["a", "b"] });
    expect(out.phrases.some((p) => p.label.includes("maria"))).toBe(false);
    expect(out.words.map((w) => w.label)).toContain("easy");
    expect(out.words.map((w) => w.label)).not.toContain("to");
    expect(questionQuery("What do they say about the mobile app?")).toBe('"mobile"* OR "app"*');
    expect(questionQuery("what is it?")).toBeNull();
  });

  it("VOC-01 reads the inbox's search index: the breakdown, shared phrases, and what they love or want improved", () => {
    seed();
    const r = vocReport(projectId, f());
    expect(r.breakdown).toMatchObject({ count: 8, rated: 8, average: 3.6, sentiment: { positive: 5, neutral: 1, negative: 2, unrated: 0 } });
    expect(r.breakdown.ratings.find((x) => x.value === 5)?.count).toBe(3);
    const phrases = r.keywords.phrases.map((p) => p.label);
    expect(phrases).toEqual(expect.arrayContaining(["easy to use", "customer support", "mobile app"]));
    expect(r.keywords.phrases.find((p) => p.label === "easy to use")?.count).toBe(4);
    expect(r.keywords.love.map((p) => p.label)).toEqual(expect.arrayContaining(["easy to use", "customer support"]));
    expect(r.keywords.love.map((p) => p.label)).not.toContain("mobile app");
    expect(r.keywords.improve.map((p) => p.label)).toEqual(expect.arrayContaining(["mobile app", "keeps crashing"]));
    expect(r.keywords.improve.find((p) => p.label === "mobile app")?.count).toBe(3);
    // Names, emails, companies and tags are in the index but never count.
    const all = [...r.keywords.words, ...r.keywords.phrases].map((p) => p.label).join(" ");
    expect(all).not.toMatch(/maria|gonzalez|globex|example|pricing/);
    // Citations name who said it.
    const id = r.keywords.phrases.find((p) => p.label === "mobile app")!.ids[0];
    expect(r.cited[id]).toMatchObject({ name: expect.any(String), excerpt: expect.stringMatching(/mobile app/i) });
  });

  it("VOC-01 follows the date range and tags, and leaves out rejected and trashed testimonials", () => {
    const ids = seed();
    getDb().update(schema.testimonials).set({ createdAt: new Date("2025-01-10T12:00:00Z") }).where(eq(schema.testimonials.id, ids[0])).run();
    updateTestimonial(ids[1], { status: "rejected" }, { quiet: true });
    expect(vocReport(projectId, f()).breakdown.count).toBe(7);
    expect(vocReport(projectId, f({ from: "2025-01-10", to: "2025-01-10" })).breakdown.count).toBe(1);
    expect(vocReport(projectId, f({ to: "2025-01-09" })).breakdown.count).toBe(0);
    expect(vocReport(projectId, f({ tags: ["pricing"] })).breakdown.count).toBe(2);
  });

  it("VOC-01 the route answers viewers too, and checks its filters", async () => {
    seed();
    await invite("vera@team.example", "viewer");
    const res = await vocRoute(req(`/api/admin/projects/${projectId}/insights?tags=pricing`, { email: "vera@team.example" }), params({ id: projectId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ai: false, canUseAi: false, report: { breakdown: { count: 2 } } });
    expect((await vocRoute(req(`/api/admin/projects/${projectId}/insights?from=yesterday`), params({ id: projectId }))).status).toBe(400);
  });
});

describe("VOC-01 themes with AI", () => {
  it("VOC-01 sends a capped sample of words and ratings (no names or emails) and keeps only themes that cite what was sent", async () => {
    seed();
    const project = getProjectById(projectId)!;
    await expect(vocThemes(project, f())).rejects.toMatchObject({ status: 409 });
    const sent: AiRequest[] = [];
    setAiStub((r) => {
      sent.push(r);
      return {
        summary: "Customers love the setup and support; the mobile app needs work.",
        themes: [
          { name: "Ease of use", summary: "Quick setup.", sentiment: "positive", refs: ["T1", "T2", "T99"] },
          { name: "Made up", summary: "No source.", sentiment: "negative", refs: ["T42"] },
        ],
        love: [{ point: "Fast support", refs: ["T4"] }],
        improve: [{ point: "Mobile app crashes", refs: ["t7"] }],
      };
    });
    const r = await vocThemes(project, f());
    expect(sent).toHaveLength(1);
    expect(sent[0].user).toMatch(/^T1 \(\d\/5\): /);
    expect(sent[0].user).not.toMatch(/Maria|Gonzalez|@example\.com|Globex/);
    expect(sent[0].user.length).toBeLessThanOrEqual(12_000);
    expect(r.themes!.sampled).toBe(8);
    expect(r.themes!.themes.map((t) => t.name)).toEqual(["Ease of use"]);
    expect(r.themes!.themes[0].ids).toHaveLength(2);
    expect(r.themes!.improve[0].ids).toHaveLength(1);
    for (const id of r.themes!.themes[0].ids) expect(r.cited[id]).toBeTruthy();
    // The rest of the report is still there.
    expect(r.keywords.phrases.length).toBeGreaterThan(0);
  });

  it("VOC-01 a long range sends at most 60 testimonials of 500 characters, spread over it; editors only, and audit-logged", async () => {
    for (let i = 0; i < 90; i++) createTestimonial(projectId, { name: `Person ${i}`, rating: 4, text: `Number ${i}. ${"The onboarding was smooth and quick. ".repeat(30)}` });
    let user = "";
    setAiStub((r) => {
      user = r.user;
      return { summary: "", themes: [], love: [], improve: [] };
    });
    const res = await themesRoute(req(`/api/admin/projects/${projectId}/insights/themes`, { json: {} }), params({ id: projectId }));
    expect(res.status).toBe(200);
    const lines = user.split("\n");
    expect(lines.length).toBeLessThanOrEqual(60);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(520);
    expect(user.length).toBeLessThanOrEqual(12_000);
    expect(listAudit({ projectId }, { limit: 10, offset: 0 }).rows[0].action).toBe("insights.ai_themes");
    await invite("vera@team.example", "viewer");
    expect((await themesRoute(req(`/api/admin/projects/${projectId}/insights/themes`, { json: {}, email: "vera@team.example" }), params({ id: projectId }))).status).toBe(403);
  });
});

describe("VOC-01 ask a question", () => {
  it("VOC-01 without AI returns the matching testimonials and no summary", async () => {
    seed();
    const res = await askRoute(req(`/api/admin/projects/${projectId}/insights/ask`, { json: { question: "What do they say about the mobile app?" } }), params({ id: projectId }));
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result).toMatchObject({ method: "keywords", answer: null, cited: [] });
    expect(result.matches).toHaveLength(3);
    for (const m of result.matches) expect(m.excerpt).toMatch(/mobile app/i);
    expect(result.note).toMatch(/With AI on/);
    expect((await askRoute(req(`/api/admin/projects/${projectId}/insights/ask`, { json: { question: "  " } }), params({ id: projectId }))).status).toBe(400);
    const none = await askQuestion(getProjectById(projectId)!, "zebra migrations", f(), { summarize: true });
    expect(none).toMatchObject({ matches: [], note: expect.stringMatching(/No testimonials/) });
  });

  it("VOC-01 with AI an editor gets a short answer citing the testimonials it used; a viewer gets the testimonials", async () => {
    seed();
    const sent: AiRequest[] = [];
    setAiStub((r) => {
      sent.push(r);
      return { answer: "Three customers say the mobile app crashes or is slow.", refs: ["T1", "T2", "T9"] };
    });
    const { result } = await (await askRoute(req(`/api/admin/projects/${projectId}/insights/ask`, { json: { question: "mobile app" } }), params({ id: projectId }))).json();
    expect(result.answer).toBe("Three customers say the mobile app crashes or is slow.");
    expect(result.cited).toEqual([result.matches[0].id, result.matches[1].id]);
    expect(sent[0].user).toMatch(/^Question: mobile app/);
    expect(sent[0].user).not.toMatch(/@example\.com/);
    expect(listAudit({ projectId }, { limit: 10, offset: 0 }).rows[0].action).toBe("insights.ai_ask");

    await invite("vera@team.example", "viewer");
    const viewer = await (await askRoute(req(`/api/admin/projects/${projectId}/insights/ask`, { json: { question: "mobile app" }, email: "vera@team.example" }), params({ id: projectId }))).json();
    expect(viewer.result).toMatchObject({ answer: null, note: expect.stringMatching(/an editor can ask/) });
    expect(sent).toHaveLength(1);

    // A project with AI off: nothing is sent.
    expect((await aiRoute(req(`/api/admin/projects/${projectId}/ai`, { method: "PUT", json: { enabled: false } }), params({ id: projectId }))).status).toBe(200);
    const off = await (await askRoute(req(`/api/admin/projects/${projectId}/insights/ask`, { json: { question: "mobile app" } }), params({ id: projectId }))).json();
    expect(off.result.answer).toBeNull();
    expect(sent).toHaveLength(1);
  });
});

describe("VOC-01 saved reports", () => {
  it("VOC-01 are saved as shown, listed, read back, exported as CSV (editors) and deleted, each audit-logged", async () => {
    seed();
    const report = vocReport(projectId, f());
    const saved = await saveReportRoute(req(`/api/admin/projects/${projectId}/insight-reports`, { json: { kind: "voc", name: "Q3 voice of customer", params: { from: "2026-07-01" }, result: report } }), params({ id: projectId }));
    expect(saved.status).toBe(201);
    const { report: r } = await saved.json();
    expect((await saveReportRoute(req(`/api/admin/projects/${projectId}/insight-reports`, { json: { kind: "voc", name: "", result: {} } }), params({ id: projectId }))).status).toBe(400);
    expect((await saveReportRoute(req(`/api/admin/projects/${projectId}/insight-reports`, { json: { kind: "other", name: "x", result: {} } }), params({ id: projectId }))).status).toBe(400);

    const list = await (await listReportsRoute(req(`/api/admin/projects/${projectId}/insight-reports`), params({ id: projectId }))).json();
    expect(list.reports).toEqual([expect.objectContaining({ id: r.id, kind: "voc", name: "Q3 voice of customer", createdBy: ADMIN_EMAIL })]);
    const full = await (await getReportRoute(req(`/api/admin/insight-reports/${r.id}`), params({ id: r.id }))).json();
    expect(full.report.result.breakdown.count).toBe(8);

    const csv = await reportCsvRoute(req(`/api/admin/insight-reports/${r.id}/csv`), params({ id: r.id }));
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toBe("Section,Item,Count,Summary,Testimonials");
    expect(text).toContain("Phrase,easy to use,4,");
    expect(text).not.toContain("@example.com");

    // An ask report and an NPS one have their own columns.
    const ask = await askQuestion(getProjectById(projectId)!, "mobile app", f(), { summarize: false });
    const a = await (await saveReportRoute(req(`/api/admin/projects/${projectId}/insight-reports`, { json: { kind: "ask", name: "Mobile", result: ask } }), params({ id: projectId }))).json();
    expect(await (await reportCsvRoute(req(`/api/admin/insight-reports/${a.report.id}/csv`), params({ id: a.report.id }))).text()).toMatch(/^Row,Text,Name,Rating,Date\r\nQuestion,mobile app/);

    await invite("vera@team.example", "viewer");
    expect((await getReportRoute(req(`/api/admin/insight-reports/${r.id}`, { email: "vera@team.example" }), params({ id: r.id }))).status).toBe(200);
    expect((await reportCsvRoute(req(`/api/admin/insight-reports/${r.id}/csv`, { email: "vera@team.example" }), params({ id: r.id }))).status).toBe(403);
    expect((await deleteReportRoute(req(`/api/admin/insight-reports/${r.id}`, { method: "DELETE", email: "vera@team.example" }), params({ id: r.id }))).status).toBe(403);
    expect((await deleteReportRoute(req(`/api/admin/insight-reports/${r.id}`, { method: "DELETE" }), params({ id: r.id }))).status).toBe(204);
    const actions = listAudit({ projectId }, { limit: 50, offset: 0 }).rows.map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["insights.report_save", "insights.report_export", "insights.report_delete"]));
  });

  it("VOC-01 AI in this project is switched by admins only", async () => {
    await invite("eddie@team.example", "editor");
    expect((await aiRoute(req(`/api/admin/projects/${projectId}/ai`, { method: "PUT", json: { enabled: false }, email: "eddie@team.example" }), params({ id: projectId }))).status).toBe(403);
    expect((await aiRoute(req(`/api/admin/projects/${projectId}/ai`, { method: "PUT", json: { enabled: "no" } }), params({ id: projectId }))).status).toBe(400);
    const res = await aiRoute(req(`/api/admin/projects/${projectId}/ai`, { method: "PUT", json: { enabled: false } }), params({ id: projectId }));
    expect(await res.json()).toEqual({ aiEnabled: false, serverAi: false });
    expect(getProjectById(projectId)!.aiEnabled).toBe(false);
    expect(listAudit({ projectId }, { limit: 5, offset: 0 }).rows[0].action).toBe("project.ai_off");
  });
});
