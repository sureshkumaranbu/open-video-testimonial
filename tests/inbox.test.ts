import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as feedbackDelete, GET as feedbackGet } from "@/app/api/admin/projects/[id]/feedback/route";
import { GET as listRoute } from "@/app/api/admin/projects/[id]/testimonials/route";
import { PATCH as answerRoute } from "@/app/api/admin/answers/[id]/route";
import { PUT as highlightsRoute } from "@/app/api/admin/testimonials/[id]/highlights/route";
import { GET as prefsGet, PUT as prefsPut } from "@/app/api/admin/me/prefs/route";
import { getDb, schema } from "@/db";
import { insertAnswers } from "@/lib/answers";
import { insertFeedback } from "@/lib/feedback";
import { listHistory } from "@/lib/history";
import { insertImages } from "@/lib/images";
import {
  DEFAULT_QUERY,
  getInboxPrefs,
  inboxCounts,
  inboxFacets,
  parseInboxParams,
  queryTestimonials,
  toInboxParams,
  type InboxQuery,
} from "@/lib/inbox";
import { toFtsQuery } from "@/lib/search";
import { createProject, createTestimonial, getTestimonial, updateTestimonial, type NewTestimonial } from "@/lib/testimonials";
import { trashTestimonial } from "@/lib/trash";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let otherId: string;

const q = (over: Partial<InboxQuery> = {}): InboxQuery => ({ ...DEFAULT_QUERY, tab: "all", ...over });
const names = (over: Partial<InboxQuery> = {}) => queryTestimonials(projectId, q(over)).items.map((t) => t.authorName);
const day = (d: string) => new Date(`${d}T12:00:00Z`);

function add(name: string, o: Partial<NewTestimonial> & { at?: string; source?: string } = {}) {
  const { at, source, ...input } = o;
  return createTestimonial(projectId, { name, ...input }, { createdAt: day(at ?? "2026-10-01"), source }).id;
}

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  otherId = createProject({ name: "Other", slug: "other" }).id;
});
afterEach(() => ctx.cleanup());

describe("INBOX-03 filters", () => {
  let ids: Record<string, string>;
  beforeEach(() => {
    const db = getDb();
    const formId = db.select().from(schema.forms).where(eq(schema.forms.projectId, projectId)).get()!.id;
    ids = {
      ada: add("Ada", { text: "Fast and friendly support", rating: 5, at: "2026-10-01", formId, language: "en", avatarKey: "images/a.png" }),
      bo: add("Bo", { text: "Pricing was clear", rating: 4, at: "2026-10-02", platform: "google", language: "de", companyLogoKey: "images/l.png", source: "importer:google" }),
      cy: add("Cy", { text: "Meh", rating: 2, at: "2026-10-03", platform: "trustpilot", source: "import:csv" }),
      di: add("Di", { videoKey: "videos/d.webm", at: "2026-10-04", source: "manual" }),
      ed: add("Ed", { text: "One two three four five six seven eight nine ten eleven", rating: 5, at: "2026-10-05", source: "api" }),
    };
    updateTestimonial(ids.ada, { tags: ["pricing", "home"] });
    updateTestimonial(ids.bo, { tags: ["pricing"] });
    db.transaction((tx) => insertImages(tx, ids.cy, [{ questionKey: null, key: "images/c.png" }]));
    db.transaction((tx) => insertAnswers(tx, ids.ed, [{ questionKey: "q2", questionTitle: "More?", position: 1, text: "extra", videoKey: "videos/e.webm" }]));
    db.update(schema.testimonials).set({ consentScopes: '["website","social"]' }).where(eq(schema.testimonials.id, ids.bo)).run();
    // Another project's row never shows up.
    createTestimonial(otherId, { name: "Zed", text: "Pricing", rating: 5 });
  });

  it("INBOX-03 each filter alone", () => {
    expect(names({ rating: [5] }).sort()).toEqual(["Ada", "Ed"]);
    expect(names({ rating: [0] })).toEqual(["Di"]);
    expect(names({ tags: ["pricing"] }).sort()).toEqual(["Ada", "Bo"]);
    expect(names({ tags: ["pricing", "home"], tagMode: "all" })).toEqual(["Ada"]);
    expect(names({ tags: ["pricing", "home"], tagMode: "any" }).sort()).toEqual(["Ada", "Bo"]);
    expect(names({ formId: getTestimonial(ids.ada)!.formId })).toEqual(["Ada"]);
    expect(names({ type: "video" }).sort()).toEqual(["Di", "Ed"]);
    expect(names({ type: "image" })).toEqual(["Cy"]);
    expect(names({ type: "text" }).sort()).toEqual(["Ada", "Bo"]);
    expect(names({ platform: ["google", "trustpilot"] }).sort()).toEqual(["Bo", "Cy"]);
    expect(names({ method: ["manual"] })).toEqual(["Di"]);
    expect(names({ method: ["csv", "platform"] }).sort()).toEqual(["Bo", "Cy"]);
    expect(names({ method: ["api"] })).toEqual(["Ed"]);
    expect(names({ method: ["form"] })).toEqual(["Ada"]);
    expect(names({ language: "DE" })).toEqual(["Bo"]);
    expect(names({ hasAvatar: true })).toEqual(["Ada"]);
    expect(names({ hasLogo: true })).toEqual(["Bo"]);
    expect(names({ hasImages: true })).toEqual(["Cy"]);
    expect(names({ scope: "social" })).toEqual(["Bo"]);
    expect(names({ wordsMin: 10 })).toEqual(["Ed"]);
    expect(names({ wordsMax: 1 }).sort()).toEqual(["Cy", "Di"]);
    expect(names({ from: "2026-10-02", to: "2026-10-03" }).sort()).toEqual(["Bo", "Cy"]);
  });

  it("INBOX-03 filters combine, and the search narrows them further", () => {
    expect(names({ rating: [4, 5], tags: ["pricing"], type: "text" }).sort()).toEqual(["Ada", "Bo"]);
    expect(names({ rating: [4, 5], tags: ["pricing"], q: "clear" })).toEqual(["Bo"]);
    // Tags are searchable too.
    expect(names({ rating: [4, 5], q: "pricing" }).sort()).toEqual(["Ada", "Bo"]);
    expect(names({ rating: [5], method: ["api"], wordsMin: 5 })).toEqual(["Ed"]);
    expect(names({ rating: [1] })).toEqual([]);
  });

  it("INBOX-04 sorts by date added, date posted, rating, name and words, both ways", () => {
    expect(names()).toEqual(["Ed", "Di", "Cy", "Bo", "Ada"]);
    expect(names({ dir: "asc" })).toEqual(["Ada", "Bo", "Cy", "Di", "Ed"]);
    expect(names({ sort: "name", dir: "asc" })).toEqual(["Ada", "Bo", "Cy", "Di", "Ed"]);
    // Unrated rows come last either way; ties fall back to newest first.
    expect(names({ sort: "rating" })).toEqual(["Ed", "Ada", "Bo", "Cy", "Di"]);
    expect(names({ sort: "rating", dir: "asc" })).toEqual(["Cy", "Bo", "Ed", "Ada", "Di"]);
    expect(names({ sort: "words" })[0]).toBe("Ed");
    getDb().update(schema.testimonials).set({ sourceDate: day("2020-01-01") }).where(eq(schema.testimonials.id, ids.ed)).run();
    expect(names({ sort: "posted" }).at(-1)).toBe("Ed");
  });

  it("INBOX-05 pages on the server", () => {
    for (let i = 0; i < 30; i++) add(`Extra ${String(i).padStart(2, "0")}`, { at: "2025-01-01" });
    const first = queryTestimonials(projectId, q({ pageSize: 25 }));
    expect(first.total).toBe(35);
    expect(first.items).toHaveLength(25);
    const second = queryTestimonials(projectId, q({ pageSize: 25, page: 2 }));
    expect(second.items).toHaveLength(10);
    expect(new Set([...first.items, ...second.items].map((t) => t.id)).size).toBe(35);
    expect(queryTestimonials(projectId, q({ page: 9 })).items).toEqual([]);
  });

  it("INBOX-01 rows carry their tags and what else they have", () => {
    const [ed] = queryTestimonials(projectId, q({ method: ["api"] })).items;
    expect(ed).toMatchObject({ answerCount: 1, answerVideoCount: 1, imageCount: 0, tags: [] });
    const [cy] = queryTestimonials(projectId, q({ type: "image" })).items;
    expect(cy.imageCount).toBe(1);
    expect(inboxFacets(projectId)).toMatchObject({ tags: ["home", "pricing"], platforms: ["google", "trustpilot"], languages: ["de", "en"] });
  });
});

describe("INBOX-01 tabs and counts", () => {
  it("INBOX-01 counts every tab, feedback and trash included, and All leaves out the trash", () => {
    const a = add("Ann");
    const b = add("Ben");
    const c = add("Cat");
    const d = add("Dan");
    const e = add("Eve");
    updateTestimonial(b, { status: "approved" });
    updateTestimonial(c, { status: "hidden" });
    updateTestimonial(d, { status: "rejected" });
    trashTestimonial(e);
    getDb().transaction((tx) =>
      insertFeedback(tx, projectId, [{ formId: null, customerId: null, testimonialId: null, rating: 2, text: "Slow", authorName: null, authorEmail: null }]),
    );
    expect(inboxCounts(projectId, q())).toEqual({ all: 4, pending: 1, approved: 1, hidden: 1, rejected: 1, feedback: 1, trash: 1 });
    expect(names({ tab: "all" }).sort()).toEqual(["Ann", "Ben", "Cat", "Dan"]);
    expect(names({ tab: "trash" })).toEqual(["Eve"]);
    expect(names({ tab: "hidden" })).toEqual(["Cat"]);
    expect(names({ tab: "pending" })).toEqual(["Ann"]);
    expect(names({ tab: "feedback" })).toEqual([]);
    // Counts follow the search.
    expect(inboxCounts(projectId, q({ q: "ann" }))).toMatchObject({ all: 1, pending: 1, approved: 0 });
    expect(a).toBeTruthy();
  });

  it("INBOX-01 the list route answers a page with counts, facets and the remembered sort", async () => {
    add("Ann", { rating: 3, at: "2026-10-01" });
    add("Ben", { rating: 5, at: "2026-10-02" });
    const get = (qs: string) =>
      listRoute(new Request(`http://localhost/api/admin/projects/${projectId}/testimonials?${qs}`, { headers: adminHeaders() }), params({ id: projectId }));
    const body = await (await get("tab=all&facets=1")).json();
    expect(body.items.map((t: { authorName: string }) => t.authorName)).toEqual(["Ben", "Ann"]);
    expect(body).toMatchObject({ total: 2, page: 1, pageSize: 25, counts: { all: 2, pending: 2 } });
    expect(body.facets.forms).toHaveLength(1);
    expect(body.items[0].authorEmail).toBeNull();

    const put = await prefsPut(
      new Request("http://localhost/api/admin/me/prefs", {
        method: "PUT",
        headers: { ...adminHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ ui: { inboxSort: "rating", inboxDir: "asc", inboxView: "table" } }),
      }),
    );
    expect(put.status).toBe(200);
    expect(getInboxPrefs(ADMIN_EMAIL)).toMatchObject({ inboxSort: "rating", inboxDir: "asc", inboxView: "table", pageSize: 25 });
    expect((await (await prefsGet(new Request("http://localhost/api/admin/me/prefs", { headers: adminHeaders() }))).json()).ui.inboxView).toBe("table");
    const sorted = await (await get("tab=all")).json();
    expect(sorted.items.map((t: { authorName: string }) => t.authorName)).toEqual(["Ann", "Ben"]);
    // The URL still wins over the remembered sort.
    const byName = await (await get("tab=all&sort=name&dir=desc")).json();
    expect(byName.items.map((t: { authorName: string }) => t.authorName)).toEqual(["Ben", "Ann"]);

    const bad = await prefsPut(
      new Request("http://localhost/api/admin/me/prefs", {
        method: "PUT",
        headers: { ...adminHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ ui: { pageSize: 7 } }),
      }),
    );
    expect(bad.status).toBe(400);
    expect((await get("tab=all")).status).toBe(200);
    expect((await listRoute(new Request(`http://localhost/api/admin/projects/nope/testimonials`, { headers: adminHeaders() }), params({ id: "nope" }))).status).toBe(404);
    expect((await listRoute(new Request(`http://localhost/api/admin/projects/${projectId}/testimonials`), params({ id: projectId }))).status).toBe(401);
  });

  it("INBOX-01 the Feedback tab lists and deletes this project's feedback only", async () => {
    const [mine] = getDb().transaction((tx) =>
      insertFeedback(tx, projectId, [{ formId: null, customerId: null, testimonialId: null, rating: 1, text: "Too slow", authorName: "Fay", authorEmail: null }]),
    );
    const [theirs] = getDb().transaction((tx) =>
      insertFeedback(tx, otherId, [{ formId: null, customerId: null, testimonialId: null, rating: 1, text: "Other", authorName: null, authorEmail: null }]),
    );
    const list = await (await feedbackGet(new Request(`http://localhost/x`, { headers: adminHeaders() }), params({ id: projectId }))).json();
    expect(list.items.map((f: { text: string }) => f.text)).toEqual(["Too slow"]);
    const del = await feedbackDelete(
      new Request(`http://localhost/x`, {
        method: "DELETE",
        headers: { ...adminHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ ids: [mine.id, theirs.id] }),
      }),
      params({ id: projectId }),
    );
    expect(await del.json()).toEqual({ deleted: 1 });
    expect(getDb().select().from(schema.feedback).all().map((f) => f.id)).toEqual([theirs.id]);
  });
});

describe("INBOX-03 shareable view", () => {
  it("INBOX-03 the URL round-trips every filter, and defaults stay out of it", () => {
    const view: InboxQuery = {
      ...DEFAULT_QUERY,
      tab: "approved",
      q: "fast support",
      rating: [4, 5, 0],
      tags: ["pricing", "a,b"],
      tagMode: "all",
      formId: "f1",
      type: "video",
      platform: ["google"],
      method: ["form", "csv"],
      language: "pt-BR",
      hasAvatar: true,
      hasLogo: true,
      hasImages: true,
      scope: "social",
      wordsMin: 10,
      wordsMax: null,
      from: "2026-01-01",
      to: "2026-10-31",
      sort: "rating",
      dir: "asc",
      page: 3,
      pageSize: 50,
    };
    const sp = toInboxParams(view);
    const back = parseInboxParams(new URLSearchParams(sp.toString()));
    expect({ ...back, rating: [...back.rating].sort() }).toEqual({ ...view, rating: [0, 4, 5] });
    expect(toInboxParams(DEFAULT_QUERY).toString()).toBe("");
    expect(parseInboxParams(new URLSearchParams())).toEqual(DEFAULT_QUERY);
    expect(DEFAULT_QUERY.tab).toBe("pending");
  });

  it("INBOX-03 nonsense in a hand-edited URL falls back to the defaults", () => {
    const v = parseInboxParams(new URLSearchParams("tab=nope&rating=9,x,4&sort=evil&dir=up&page=-2&size=7&type=gif&from=yesterday&words=a-b&method=fax,form"));
    expect(v).toMatchObject({ tab: "pending", rating: [], sort: "created", dir: "desc", page: 1, pageSize: 25, type: null, from: null, wordsMin: null, method: [] });
    // Remembered defaults apply when the URL says nothing.
    expect(parseInboxParams(new URLSearchParams(), { sort: "name", dir: "asc", pageSize: 100 })).toMatchObject({ sort: "name", dir: "asc", pageSize: 100 });
    expect(toInboxParams({ ...DEFAULT_QUERY, sort: "name", dir: "asc" }, { sort: "name", dir: "asc" }).toString()).toBe("");
  });
});

describe("INBOX-02 search", () => {
  it("INBOX-02 finds words in the text, transcript, answers, tags, name, company and email, by prefix", () => {
    const db = getDb();
    const a = add("Ann Archer", { text: "The onboarding was wonderful", company: "Globex", email: "ann@initech.example" });
    const b = add("Ben", { text: "Nothing special" });
    const c = add("Cat", { text: "Fine" });
    db.update(schema.testimonials).set({ transcript: "We doubled our conversion rate" }).where(eq(schema.testimonials.id, b)).run();
    db.transaction((tx) => insertAnswers(tx, c, [{ questionKey: "q2", questionTitle: "Why?", position: 1, text: "Because of the integrations" }]));
    updateTestimonial(c, { tags: ["enterprise"] });
    expect(names({ q: "onboard" })).toEqual(["Ann Archer"]);
    expect(names({ q: "conversion" })).toEqual(["Ben"]);
    expect(names({ q: "integrations" })).toEqual(["Cat"]);
    expect(names({ q: "enterprise" })).toEqual(["Cat"]);
    expect(names({ q: "globex" })).toEqual(["Ann Archer"]);
    expect(names({ q: "initech" })).toEqual(["Ann Archer"]);
    expect(names({ q: "archer onboarding" })).toEqual(["Ann Archer"]);
    expect(names({ q: "archer conversion" })).toEqual([]);
    // Edits are searchable at once.
    updateTestimonial(a, { text: "Rewritten entirely" });
    expect(names({ q: "onboarding" })).toEqual([]);
    expect(names({ q: "rewritten" })).toEqual(["Ann Archer"]);
    // Only this project's rows.
    createTestimonial(otherId, { name: "Rewritten Rita", text: "rewritten" });
    expect(names({ q: "rewritten" })).toEqual(["Ann Archer"]);
  });

  it("INBOX-02 FTS syntax in the input is treated as plain words and never fails", () => {
    add("Quote Quinn", { text: 'She said "near" the end' });
    for (const raw of ['"', '""', 'NEAR(', "NEAR(a b)", "*", "a*", "col:x", "(", ")", "^", "-", "AND OR NOT", "'", "😀", "a\u0000b"]) {
      expect(() => queryTestimonials(projectId, q({ q: raw })), raw).not.toThrow();
    }
    expect(names({ q: '"near' })).toEqual(["Quote Quinn"]);
    expect(names({ q: "NEAR(end" })).toEqual(["Quote Quinn"]);
    expect(toFtsQuery('NEAR( "quote" * OR x')).toBe('"quote"* "x"*');
    expect(toFtsQuery("   ")).toBeNull();
    expect(toFtsQuery("* ( ) :")).toBeNull();
    expect(toFtsQuery("a b c d e f g h i j k l")?.split(" ")).toHaveLength(10);
    expect(toFtsQuery("ann@initech.example")).toBe('"ann@initech.example"*');
  });
});

describe("INBOX-08 answers and highlights through the API", () => {
  it("INBOX-08 edits an answer and highlights a phrase, both in the history", async () => {
    const id = add("Ann", { text: "Fast and friendly support" });
    const [answer] = getDb().transaction((tx) => insertAnswers(tx, id, [{ questionKey: "q2", questionTitle: "What else?", position: 1, text: "Great docs" }]));
    const patch = await answerRoute(
      new Request("http://localhost/x", { method: "PATCH", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ text: "Great docs and API" }) }),
      params({ id: answer.id }),
    );
    expect(patch.status).toBe(200);
    expect((await patch.json()).answer.text).toBe("Great docs and API");
    expect(getTestimonial(id)!.editedAfterConsent).toBe(true);

    const put = (body: unknown) =>
      highlightsRoute(
        new Request("http://localhost/x", { method: "PUT", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) }),
        params({ id }),
      );
    const ok = await put({ highlights: [{ answerId: null, start: 9, end: 25 }, { answerId: answer.id, start: 0, end: 10 }] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).highlights.map((h: { phrase: string }) => h.phrase).sort()).toEqual(["Great docs", "friendly support"]);
    expect((await put({ highlights: [{ answerId: null, start: 5, end: 99 }] })).status).toBe(400);
    expect((await put({ highlights: [{ answerId: "someone-else", start: 0, end: 2 }] })).status).toBe(400);
    expect(listHistory(id).map((h) => h.action)).toEqual(expect.arrayContaining(["answer_edited", "highlights"]));
    expect(listHistory(id).find((h) => h.action === "answer_edited")?.actorEmail).toBe(ADMIN_EMAIL);
    expect(
      (
        await answerRoute(
          new Request("http://localhost/x", { method: "PATCH", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ text: "x" }) }),
          params({ id: "missing" }),
        )
      ).status,
    ).toBe(404);
  });
});
