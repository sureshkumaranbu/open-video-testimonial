import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as detailRoute } from "@/app/api/admin/testimonials/[id]/detail/route";
import { GET as historyRoute } from "@/app/api/admin/testimonials/[id]/history/route";
import { PATCH as patchRoute } from "@/app/api/admin/testimonials/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/projects/[slug]/testimonials/route";
import { GET as getRoute, PATCH as v1Patch } from "@/app/api/v1/testimonials/[id]/route";
import { getDb, schema } from "@/db";
import type { Form } from "@/db/schema";
import { insertAnswers, listAnswers, updateAnswer } from "@/lib/answers";
import { createApiKey } from "@/lib/api-keys";
import { currentConsentVersion, currentConsentVersionFor, listConsentEvents, listConsentVersions } from "@/lib/consent";
import { countWords, formatSourceDate } from "@/lib/dates";
import { formConfigFromProject, primaryQuestion } from "@/lib/forms/defaults";
import { parseFormRow } from "@/lib/forms/schema";
import { HighlightError, listHighlights, setHighlights } from "@/lib/highlights";
import { listHistory } from "@/lib/history";
import { runPeriodicTasks } from "@/lib/jobs";
import { backfillWordCounts, registerMaintenanceJobs } from "@/lib/maintenance";
import {
  createProject,
  createTestimonial,
  DEFAULT_QUESTIONS,
  getProjectById,
  getTestimonial,
  projectQuestions,
  updateProject,
  updateTestimonial,
} from "@/lib/testimonials";
import { trashTestimonial } from "@/lib/trash";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const newOne = (text = "Setup took minutes and support was great") =>
  createTestimonial(projectId, { name: "Ada", email: "ada@example.com", text, rating: 5 }).id;

const admin = (url: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { ...adminHeaders(), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const patch = (id: string, body: unknown) => patchRoute(admin(`/api/admin/testimonials/${id}`, "PATCH", body), params({ id }));

const withKey = (key: string, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function answer(testimonialId: string, text: string, key = "q2") {
  return getDb().transaction((tx) =>
    insertAnswers(tx, testimonialId, [{ questionKey: key, questionTitle: "What changed?", position: 1, text }]),
  )[0];
}

describe("INBOX-10 history", () => {
  it("records who changed what through the dashboard, with their email", async () => {
    const id = newOne();
    expect((await patch(id, { authorName: "Ada L.", rating: 4 })).status).toBe(200);
    expect((await patch(id, { tags: ["Home", "pricing"] })).status).toBe(200);
    expect((await patch(id, { status: "approved" })).status).toBe(200);
    expect((await patch(id, { tags: ["pricing", "home"] })).status).toBe(200); // same tags: nothing to record

    const history = listHistory(id);
    expect(history.map((h) => [h.action, h.actor, h.actorEmail])).toEqual([
      ["created", "customer", null],
      ["edited", "owner", ADMIN_EMAIL],
      ["tags", "owner", ADMIN_EMAIL],
      ["status", "owner", ADMIN_EMAIL],
    ]);
    const res = await historyRoute(admin(`/api/admin/testimonials/${id}/history`), params({ id }));
    const body = (await res.json()).history;
    expect(body[1].diff).toEqual({ authorName: ["Ada", "Ada L."], rating: [5, 4] });
    expect(body[2].diff).toEqual({ tags: [[], ["home", "pricing"]] });
    expect(body[3].diff).toEqual({ status: ["pending", "approved"] });
  });

  it("says when a change came through the API or auto-approve", async () => {
    const id = newOne();
    const { key } = createApiKey("zap", "write");
    const res = await v1Patch(withKey(key, `/api/v1/testimonials/${id}`, { status: "hidden" }, "PATCH"), params({ id }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("hidden");
    updateTestimonial(id, { status: "pending" });
    updateTestimonial(id, { status: "approved" }, { actor: "auto", rule: "4+ stars" });
    expect(listHistory(id).slice(1).map((h) => [h.actor, h.diff])).toEqual([
      ["api", '{"status":["pending","hidden"]}'],
      ["owner", '{"status":["hidden","pending"]}'],
      ["auto", '{"status":["pending","approved"]}'],
    ]);
  });

  it("is only for the signed-in, and 404s for unknown testimonials", async () => {
    const id = newOne();
    const anon = new Request(`http://localhost/api/admin/testimonials/${id}/history`);
    expect((await historyRoute(anon, params({ id }))).status).toBe(401);
    const missing = crypto.randomUUID();
    expect((await historyRoute(admin(`/api/admin/testimonials/${missing}/history`), params({ id: missing }))).status).toBe(404);
  });
});

describe("INBOX-08 editing", () => {
  it("edits every Phase 1 field, and flags only what the author wrote as edited after consent", async () => {
    const id = newOne();
    const res = await patch(id, {
      authorWebsite: "https://ada.example",
      authorPhone: "+44 20 7946 0000",
      authorSocials: { linkedin: "https://www.linkedin.com/in/ada", x: "" },
      sourceUrl: "https://reviews.example/r/1",
      sourceDate: "2026-10-01",
      datePrecision: "month",
      platform: "G2",
      language: "en-GB",
      customFields: { plan: "Enterprise", seats: 40, renewing: true },
      isFeatured: true,
      pinOrder: 2,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(getTestimonial(id)).toMatchObject({
      authorWebsite: "https://ada.example",
      authorPhone: "+44 20 7946 0000",
      authorSocials: '{"linkedin":"https://www.linkedin.com/in/ada"}',
      sourceUrl: "https://reviews.example/r/1",
      sourceDate: new Date("2026-10-01T00:00:00Z"),
      datePrecision: "month",
      platform: "g2",
      language: "en-GB",
      customFields: '{"plan":"Enterprise","seats":40,"renewing":true}',
      isFeatured: true,
      pinOrder: 2,
      editedAfterConsent: false,
    });
    expect(listConsentEvents(id)).toEqual([]);

    await patch(id, { headline: "Hours back every week" });
    expect(getTestimonial(id)).toMatchObject({ headline: "Hours back every week", editedAfterConsent: true });
    expect(listConsentEvents(id).at(-1)).toMatchObject({ type: "edited", detail: "Changed after consent: headline" });

    // Empty clears; the history keeps what was there.
    await patch(id, { headline: "", sourceUrl: null, pinOrder: null });
    expect(getTestimonial(id)).toMatchObject({ headline: null, sourceUrl: null, pinOrder: null });
    expect(JSON.parse(listHistory(id).at(-1)!.diff)).toEqual({
      headline: ["Hours back every week", null],
      sourceUrl: ["https://reviews.example/r/1", null],
      pinOrder: [2, null],
    });
  });

  it("explains what's wrong with a bad value", async () => {
    const id = newOne();
    const cases: [object, RegExp][] = [
      [{ authorWebsite: "javascript:alert(1)" }, /http:\/\/ or https:\/\//],
      [{ datePrecision: "week" }, /^Date precision must be day, month or year$/],
      [{ language: "english!" }, /language code/],
      [{ sourceDate: "last week" }, /Date/],
      [{ platform: "Trust Pilot" }, /platform/],
      [{ authorSocials: { myspace: "ada" } }, /Unknown field: myspace/],
      [{ customFields: { "Not a key": "x" } }, /./],
      [{ status: "trashed" }, /^Status must be/],
    ];
    for (const [body, message] of cases) {
      const res = await patch(id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error, JSON.stringify(body)).toMatch(message);
    }
  });

  it("sends testimonial.updated to hooks that ask for it, for content edits only", () => {
    getDb()
      .insert(schema.webhooks)
      .values({ id: "h", url: "http://127.0.0.1:9/h", secret: "whsec_x", events: '["testimonial.updated"]', active: true, createdAt: new Date() })
      .run();
    const id = newOne();
    updateTestimonial(id, { text: "Even better now" });
    updateTestimonial(id, { text: "Even better now" }); // unchanged
    updateTestimonial(id, { tags: ["home"], status: "approved" });
    updateTestimonial(id, { isFeatured: true }, { quiet: true });
    expect(getDb().select().from(schema.webhookDeliveries).all().map((d) => d.event)).toEqual(["testimonial.updated"]);
  });
});

describe("answers", () => {
  it("an edit marks the testimonial edited after consent and logs it in the ledger and the history", () => {
    getDb()
      .insert(schema.webhooks)
      .values({ id: "h", url: "http://127.0.0.1:9/h", secret: "whsec_x", events: '["testimonial.updated"]', active: true, createdAt: new Date() })
      .run();
    const id = newOne("Fast setup");
    const a = answer(id, "We ship weekly now");
    expect(getTestimonial(id)).toMatchObject({ wordCount: 6, editedAfterConsent: false });

    const updated = updateAnswer(a.id, { text: "Now we ship every single week" }, { by: ADMIN_EMAIL });
    expect(updated).toMatchObject({ text: "Now we ship every single week" });
    expect(getTestimonial(id)).toMatchObject({ editedAfterConsent: true, wordCount: 8 });
    expect(listConsentEvents(id).at(-1)).toMatchObject({
      type: "edited",
      actor: "owner",
      detail: 'Changed after consent: the answer to "What changed?"',
    });
    expect(listHistory(id).at(-1)).toMatchObject({
      action: "answer_edited",
      actorEmail: ADMIN_EMAIL,
      diff: JSON.stringify({ "answer:q2": ["We ship weekly now", "Now we ship every single week"] }),
    });
    expect(getDb().select().from(schema.webhookDeliveries).all().map((d) => d.event)).toEqual(["testimonial.updated"]);
    // The same text again changes nothing.
    updateAnswer(a.id, { text: "Now we ship every single week" });
    expect(listHistory(id).filter((h) => h.action === "answer_edited")).toHaveLength(1);
    expect(updateAnswer(crypto.randomUUID(), { text: "x" })).toBeNull();
  });

  it("are listed in question order and searchable", () => {
    const id = newOne("Main");
    getDb().transaction((tx) =>
      insertAnswers(tx, id, [
        { questionKey: "q3", questionTitle: "Who for?", position: 2, text: "Small teams" },
        { questionKey: "q2", questionTitle: "What changed?", position: 1, text: "Zebra crossings" },
      ]),
    );
    expect(listAnswers(id).map((a) => a.questionKey)).toEqual(["q2", "q3"]);
    // The search body includes answers (migration 0010).
    const hits = getDb().all<{ id: string }>(
      sql`SELECT s.testimonial_id AS id FROM testimonials_fts f JOIN testimonial_search s ON s.id = f.rowid WHERE testimonials_fts MATCH 'zebra'`,
    );
    expect(hits.map((h) => h.id)).toEqual([id]);
  });
});

describe("INBOX-08 highlights", () => {
  it("keep their phrase through an edit, and are dropped once it's gone", () => {
    const id = newOne("Setup took minutes and support was great");
    expect(setHighlights(id, [{ answerId: null, start: 0, end: 18 }, { answerId: null, start: 23, end: 40 }], { by: ADMIN_EMAIL })!.map((h) => h.phrase)).toEqual([
      "Setup took minutes",
      "support was great",
    ]);
    updateTestimonial(id, { text: "Honestly? Setup took minutes and support was great" });
    expect(listHighlights(id).map((h) => [h.start, h.end, h.phrase])).toEqual([
      [10, 28, "Setup took minutes"],
      [33, 50, "support was great"],
    ]);
    updateTestimonial(id, { text: "Honestly? Setup took minutes." });
    expect(listHighlights(id).map((h) => h.phrase)).toEqual(["Setup took minutes"]);
    expect(listHistory(id).find((h) => h.action === "highlights")).toMatchObject({
      actorEmail: ADMIN_EMAIL,
      diff: JSON.stringify({ highlights: [[], ["Setup took minutes", "support was great"]] }),
    });
  });

  it("move with an answer's text", () => {
    const id = newOne("Main");
    const a = answer(id, "We ship weekly now");
    setHighlights(id, [{ answerId: a.id, start: 3, end: 7 }]);
    updateAnswer(a.id, { text: "Now we ship every week" });
    expect(listHighlights(id)).toMatchObject([{ answerId: a.id, start: 7, end: 11, phrase: "ship" }]);
  });

  it("must cover real text of this testimonial, without overlapping", () => {
    const id = newOne("Short text");
    const other = answer(newOne("Other"), "Elsewhere");
    expect(() => setHighlights(id, [{ answerId: null, start: 0, end: 99 }])).toThrow(HighlightError);
    expect(() => setHighlights(id, [{ answerId: null, start: 5, end: 6 }])).toThrow(/more than spaces/);
    expect(() => setHighlights(id, [{ answerId: null, start: 0, end: 5 }, { answerId: null, start: 3, end: 8 }])).toThrow(/overlap/);
    expect(() => setHighlights(id, [{ answerId: other.id, start: 0, end: 4 }])).toThrow(/another testimonial/);
    expect(setHighlights(crypto.randomUUID(), [])).toBeNull();
    expect(setHighlights(id, [])).toEqual([]);
  });
});

describe("word counts", () => {
  it("count words the same way everywhere", () => {
    expect(countWords("Don't stop: e-mail us, it's 3.5 stars!")).toBe(7);
    expect(countWords("naïve café — très bien")).toBe(4);
    expect(countWords("  — ")).toBe(0);
    expect(countWords(null)).toBe(0);
  });

  it("are kept on write and backfilled for rows without one", async () => {
    const id = newOne("one two three");
    expect(getTestimonial(id)!.wordCount).toBe(3);
    updateTestimonial(id, { text: "one two" });
    expect(getTestimonial(id)!.wordCount).toBe(2);

    const other = newOne("four five six seven");
    getDb().update(schema.testimonials).set({ wordCount: null }).run();
    expect(backfillWordCounts(1)).toBe(1);
    expect(backfillWordCounts()).toBe(1);
    expect(backfillWordCounts()).toBe(0);
    expect([getTestimonial(id)!.wordCount, getTestimonial(other)!.wordCount]).toEqual([2, 4]);

    // The periodic task does the same.
    getDb().update(schema.testimonials).set({ wordCount: null }).run();
    registerMaintenanceJobs();
    await runPeriodicTasks();
    expect(getTestimonial(other)!.wordCount).toBe(4);
  });
});

describe("source dates", () => {
  it("show as exactly as they're known", () => {
    const d = new Date(Date.UTC(2026, 9, 1));
    expect(formatSourceDate(d, "month", "en")).toBe("Oct 2026");
    expect(formatSourceDate(d, "year", "en")).toBe("2026");
    expect(formatSourceDate(new Date(Date.UTC(2026, 9, 12)), "day", "en-GB")).toBe("12 Oct 2026");
    expect(formatSourceDate(d, "month", "not a locale!")).toBe("Oct 2026");
  });
});

describe("the detail drawer", () => {
  it("gets the testimonial with its answers, images, highlights, history, customer and form", async () => {
    const id = newOne();
    const db = getDb();
    const form = db.select().from(schema.forms).where(eq(schema.forms.projectId, projectId)).get()!;
    const customerId = crypto.randomUUID();
    db.insert(schema.customers).values({ id: customerId, projectId, name: "Ada", email: "ada@example.com" }).run();
    db.update(schema.testimonials).set({ formId: form.id, customerId }).where(eq(schema.testimonials.id, id)).run();
    const a = answer(id, "Weekly releases");
    db.insert(schema.testimonialImages)
      .values({ id: crypto.randomUUID(), testimonialId: id, key: `images/${crypto.randomUUID()}.png`, alt: "Dashboard" })
      .run();
    db.insert(schema.feedback).values({ id: crypto.randomUUID(), projectId, testimonialId: id, text: "Pricing page is confusing" }).run();
    setHighlights(id, [{ answerId: a.id, start: 0, end: 6 }]);

    const res = await detailRoute(admin(`/api/admin/testimonials/${id}/detail`), params({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      testimonial: { id, authorEmail: "ada@example.com", tags: [] },
      answers: [{ id: a.id, questionKey: "q2", text: "Weekly releases" }],
      images: [{ alt: "Dashboard" }],
      highlights: [{ answerId: a.id, phrase: "Weekly" }],
      customer: { id: customerId, email: "ada@example.com" },
      feedback: [{ text: "Pricing page is confusing" }],
      form: { id: form.id, isDefault: true, layout: "classic", slug: "default" },
    });
    expect(body.history.map((h: { action: string }) => h.action)).toEqual(["created", "highlights"]);
    expect(body.history[1].diff).toEqual({ highlights: [[], ["Weekly"]] });

    const missing = crypto.randomUUID();
    expect((await detailRoute(admin(`/api/admin/testimonials/${missing}/detail`), params({ id: missing }))).status).toBe(404);
    expect((await detailRoute(new Request(`http://localhost/x`), params({ id }))).status).toBe(401);
  });
});

describe("the REST API", () => {
  it("lists the new fields, and leaves the trash out unless asked", async () => {
    const { key } = createApiKey("zap", "read");
    const kept = newOne("Kept");
    const binned = newOne("Binned");
    answer(kept, "Weekly releases");
    updateTestimonial(kept, { headline: "Shipping weekly", authorWebsite: "https://ada.example" });
    trashTestimonial(binned);
    const list = async (q = "") =>
      (await (await listRoute(withKey(key, `/api/v1/projects/acme/testimonials${q}`), params({ slug: "acme" }))).json()).data as {
        id: string;
      }[];
    const all = await list();
    expect(all.map((t) => t.id)).toEqual([kept]);
    expect(all[0]).toMatchObject({
      headline: "Shipping weekly",
      answers: [{ key: "q2", title: "What changed?", text: "Weekly releases" }],
      images: [],
      author: { website: "https://ada.example", socials: {} },
      consent: { public: true },
      datePrecision: "day",
      customFields: {},
      trashedAt: null,
    });
    expect((await list("?status=trashed")).map((t) => t.id)).toEqual([binned]);
    const one = await (await getRoute(withKey(key, `/api/v1/testimonials/${binned}`), params({ id: binned }))).json();
    expect(one.data).toMatchObject({ status: "trashed", trashedAt: expect.any(String) });
  });

  it("creates testimonials with the new fields and consent scopes", async () => {
    const { key } = createApiKey("zap", "write");
    const res = await createRoute(
      withKey(key, "/api/v1/projects/acme/testimonials", {
        name: "Grace",
        text: "Our support queue halved.",
        headline: "Half the tickets",
        website: "https://grace.example",
        platform: "g2",
        sourceDate: "2026-09-01",
        datePrecision: "month",
        language: "en",
        customFields: { plan: "Pro" },
        consent: true,
        consentScopes: ["social", "ads"],
      }),
      params({ slug: "acme" }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({
      headline: "Half the tickets",
      author: { website: "https://grace.example" },
      platform: "g2",
      sourceDate: "2026-09-01T00:00:00.000Z",
      datePrecision: "month",
      customFields: { plan: "Pro" },
      source: "api",
      consent: { scopes: ["website", "social", "ads"] },
    });
    expect(listHistory(data.id)[0]).toMatchObject({ action: "created", actor: "api" });
  });
});

describe("D12 consent versions", () => {
  it("are found by their wording, so switching back reuses the old version", () => {
    const v1 = currentConsentVersion(getProjectById(projectId)!);
    updateProject(projectId, { consentText: "{project} may quote me." });
    const v2 = currentConsentVersion(getProjectById(projectId)!);
    updateProject(projectId, { consentText: "" });
    expect(currentConsentVersion(getProjectById(projectId)!).id).toBe(v1.id);
    const form = currentConsentVersionFor({ id: projectId }, "A form's own wording.");
    expect(currentConsentVersionFor({ id: projectId }, "A form's own wording.").id).toBe(form.id);
    expect(listConsentVersions(projectId).map((v) => [v.version, v.id])).toEqual([
      [1, v1.id],
      [2, v2.id],
      [3, form.id],
    ]);
  });
});

describe("D2 projects and their default form", () => {
  const defaultForm = () =>
    getDb().select().from(schema.forms).where(eq(schema.forms.projectId, projectId)).all() as Form[];
  const config = () => parseFormRow(defaultForm()[0]);

  it("a new project gets one classic default form, filled in from its settings", () => {
    expect(defaultForm()).toMatchObject([{ isDefault: true, layout: "classic", slug: "default", configVersion: 1, status: "live" }]);
    expect(config()).toEqual(formConfigFromProject(getProjectById(projectId)!));
    expect(projectQuestions(getProjectById(projectId)!)).toEqual(DEFAULT_QUESTIONS);
  });

  it("form settings go through the default form, and the columns follow it", () => {
    const saved = updateProject(projectId, {
      prompt: "What changed?",
      autoApprove: true,
      website: "https://acme.example",
      businessType: "saas",
      brand: { colors: { primary: "#112233" }, fonts: {} },
    })!;
    expect(saved).toMatchObject({ prompt: "What changed?", autoApprove: true, website: "https://acme.example", businessType: "saas" });
    expect(JSON.parse(saved.brand)).toEqual({ colors: { primary: "#112233" }, fonts: {} });
    expect(getProjectById(projectId)).toEqual(saved);
    expect(primaryQuestion(config())!.title).toBe("What changed?");
    expect(config().settings.autoApprove).toMatchObject({ mode: "rating", since: saved.autoApproveSince });
  });

  it("a SettingsPanel save keeps what was typed: empty prompts stay empty", () => {
    updateProject(projectId, { questions: "" });
    const p = getProjectById(projectId)!;
    // The panel sends every field on each save.
    const saved = updateProject(projectId, {
      prompt: "New prompt",
      questions: "",
      allowVideo: p.allowVideo,
      allowText: p.allowText,
      consentText: "",
    })!;
    expect(saved).toMatchObject({ prompt: "New prompt", questions: "", consentText: "" });
    expect(primaryQuestion(config())!.tips).toEqual(DEFAULT_QUESTIONS);
  });

  it("a default form migration 0009 left unfilled is filled in from the columns first", () => {
    getDb().update(schema.forms).set({ configVersion: 0, pages: "[]", settings: "{}" }).run();
    updateProject(projectId, { thankYouMessage: "Cheers!" });
    expect(defaultForm()[0].configVersion).toBe(1);
    expect(config()).toEqual(formConfigFromProject(getProjectById(projectId)!));
  });

  it("fields that aren't the form's leave it alone", () => {
    const before = defaultForm()[0];
    updateProject(projectId, { inviteSubject: "A favour?", name: "Acme Inc" });
    expect(defaultForm()[0]).toEqual(before);
    expect(getProjectById(projectId)).toMatchObject({ inviteSubject: "A favour?", name: "Acme Inc" });
  });

  it("deleting a project removes its forms", () => {
    getDb().delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
    expect(getDb().select().from(schema.forms).all()).toEqual([]);
  });
});
