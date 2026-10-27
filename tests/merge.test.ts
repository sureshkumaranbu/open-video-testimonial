import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as mergeRoute } from "@/app/api/admin/projects/[id]/testimonials/merge/route";
import { getDb, schema } from "@/db";
import { grantConsent, listConsentEvents, withdrawConsent } from "@/lib/consent";
import { insertAnswers, listAnswers } from "@/lib/answers";
import { setHighlights, listHighlights } from "@/lib/highlights";
import { insertImages, listImages } from "@/lib/images";
import { DEFAULT_QUERY, queryTestimonials } from "@/lib/inbox";
import { duplicateGroups, mergeTestimonials, textSimilarity } from "@/lib/merge";
import { toFeedItems } from "@/lib/public-feed";
import { getTestimonialDetail } from "@/lib/testimonial-detail";
import { createProject, createTestimonial, deleteTestimonial, getProjectById, getTestimonial, isMediaPublic, stillUsed, updateTestimonial } from "@/lib/testimonials";
import { restoreTestimonial, trashTestimonial } from "@/lib/trash";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const KEY = (n: number) => `images/${String(n).padStart(8, "0")}-1111-4111-8111-111111111111.png`;
const add = (o: Parameters<typeof createTestimonial>[1], pid = projectId) => createTestimonial(pid, o).id;
const consentFor = (id: string, scopes: ("social" | "ads")[] = []) => grantConsent({ testimonialId: id, project: getProjectById(projectId)!, scopes, actor: "customer" });
function hook(events: string[]) {
  getDb().insert(schema.webhooks).values({ id: crypto.randomUUID(), url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: JSON.stringify(events), active: true, createdAt: new Date() }).run();
}
const delivered = () => getDb().select().from(schema.webhookDeliveries).all().map((d) => [d.event, (JSON.parse(d.payload) as { data?: { testimonial?: { id: string } } }).data?.testimonial?.id]);

describe("INBOX-11 likely duplicates", () => {
  it("INBOX-11 scores near-identical words high and different ones low", () => {
    expect(textSimilarity("Plaudit saved us hours every week!", "plaudit saved us hours every week")).toBe(1);
    expect(textSimilarity("Plaudit saved us hours every single week.", "Plaudit saved us many hours every week.")).toBeGreaterThan(0.75);
    expect(textSimilarity("Great support team", "The export was slow and buggy")).toBeLessThan(0.4);
  });

  it("INBOX-11 groups the same customer or email, or the same name with similar words, and leaves the trash out", () => {
    const a = add({ name: "Ada Lovelace", email: "ada@example.com", text: "One" });
    const b = add({ name: "A. Lovelace", email: "ADA@example.com", text: "Two" });
    const c = add({ name: "Grace Hopper", text: "The setup took five minutes and it just works." });
    const d = add({ name: "grace  hopper", text: "Setup took five minutes and it just works!" });
    const e = add({ name: "Grace Hopper", text: "Completely different words about pricing." });
    const f = add({ name: "Cy", text: "Same" });
    const g = add({ name: "Dee", text: "Same" });
    const gone = add({ name: "Ada Lovelace", email: "ada@example.com", text: "Three" });
    trashTestimonial(gone);
    const groups = duplicateGroups(projectId).map((x) => [...x].sort());
    expect(groups).toEqual(expect.arrayContaining([[a, b].sort(), [c, d].sort()]));
    expect(groups.flat()).not.toContain(e);
    expect(groups.flat()).not.toContain(f);
    expect(groups.flat()).not.toContain(g);
    expect(groups.flat()).not.toContain(gone);

    const view = queryTestimonials(projectId, { ...DEFAULT_QUERY, tab: "all", dupes: true });
    expect(view.items.map((t) => t.id).sort()).toEqual([a, b, c, d].sort());
    expect(getTestimonialDetail(a)!.duplicates.map((x) => x.id)).toEqual([b]);
  });
});

describe("INBOX-11 merge into…", () => {
  function pair() {
    const a = add({ name: "Ada", email: "ada@example.com", rating: 5, text: "First words", headline: "Loved it" });
    const b = add({ name: "Ada", email: "ada@example.com", rating: 4, text: "Second words, with a highlight", headline: "Again" });
    consentFor(a);
    consentFor(b);
    updateTestimonial(a, { tags: ["pricing"], status: "approved" }, { quiet: true });
    updateTestimonial(b, { tags: ["support", "pricing"] }, { quiet: true });
    getDb().transaction((tx) => {
      insertAnswers(tx, b, [{ questionKey: "why", questionTitle: "Why us?", position: 1, text: "Because" }]);
      insertImages(tx, b, [{ questionKey: null, key: KEY(1) }]);
    });
    const ans = listAnswers(b)[0];
    setHighlights(b, [
      { answerId: null, start: 14, end: 30 },
      { answerId: ans.id, start: 0, end: 7 },
    ]);
    return { a, b };
  }

  it("INBOX-11 keeps both answers: B's text and answers become extra answers on A, highlights and tags follow, B goes to the trash", () => {
    hook(["testimonial.updated", "testimonial.trashed"]);
    const { a, b } = pair();
    const beforeA = listConsentEvents(a).length;
    const beforeB = listConsentEvents(b).length;
    const { into, from } = mergeTestimonials(projectId, b, a, { by: "owner@example.com" });

    expect(into.text).toBe("First words");
    expect(into.rating).toBe(5);
    expect(into.tags).toEqual(["pricing", "support"]);
    const answers = listAnswers(a);
    expect(answers.map((x) => [x.questionTitle, x.text])).toEqual([
      ["Again", "Second words, with a highlight"],
      ["Why us?", "Because"],
    ]);
    const marks = listHighlights(a);
    expect(marks).toHaveLength(2);
    for (const h of marks) {
      const text = answers.find((x) => x.id === h.answerId)!.text!;
      expect(text.slice(h.start, h.end)).toBe(h.phrase);
    }
    // B keeps its own ledger; A gets copies that say where they came from.
    expect(listConsentEvents(b)).toHaveLength(beforeB);
    const copied = listConsentEvents(a).slice(beforeA);
    expect(copied).toHaveLength(beforeB);
    expect(copied.every((e) => e.detail?.startsWith(`From merged testimonial ${b}`))).toBe(true);

    expect(from).toMatchObject({ status: "trashed", mergedIntoId: a, statusBeforeTrash: "pending" });
    const historyA = getDb().select().from(schema.testimonialHistory).where(eq(schema.testimonialHistory.testimonialId, a)).all().filter((h) => h.action === "merged");
    expect(historyA).toHaveLength(1);
    const historyB = getDb().select().from(schema.testimonialHistory).where(eq(schema.testimonialHistory.testimonialId, b)).all().filter((h) => h.action === "merged");
    expect(JSON.parse(historyB[0].diff).mergedInto).toEqual([null, a]);
    expect(delivered()).toEqual([
      ["testimonial.updated", a],
      ["testimonial.trashed", b],
    ]);
  });

  it("INBOX-11 never makes anything public that wasn't: images from a pending B stay owner-only on an approved A", () => {
    const { a, b } = pair();
    mergeTestimonials(projectId, b, a);
    const imgs = listImages(a);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].ownerOnly).toBe(true);
    expect(isMediaPublic(KEY(1))).toBe(false);
    expect(toFeedItems([getTestimonial(a)!])[0].extra.images).toEqual([]);
    // Answers are owner-only, so A's public text is what it was.
    expect(toFeedItems([getTestimonial(a)!])[0].text).toBe("First words");
  });

  it("INBOX-11 images from a B that was public with the same consent stay public", () => {
    const { a, b } = pair();
    updateTestimonial(b, { status: "approved" }, { quiet: true });
    mergeTestimonials(projectId, b, a);
    expect(listImages(a)[0].ownerOnly).toBe(false);
    expect(isMediaPublic(KEY(1))).toBe(true);
  });

  it("INBOX-11 images from a B with narrower consent than A's stay owner-only", () => {
    const a = add({ name: "Ada", text: "One" });
    const b = add({ name: "Ada", text: "Two" });
    consentFor(a, ["ads"]);
    consentFor(b);
    updateTestimonial(a, { status: "approved" }, { quiet: true });
    updateTestimonial(b, { status: "approved" }, { quiet: true });
    getDb().transaction((tx) => insertImages(tx, b, [{ questionKey: null, key: KEY(2) }]));
    mergeTestimonials(projectId, b, a);
    expect(listImages(a)[0].ownerOnly).toBe(true);
  });

  it("INBOX-11 restoring a merged testimonial is safe: it comes back to Pending and A keeps the copies; deleting it keeps shared files", async () => {
    const { a, b } = pair();
    updateTestimonial(b, { status: "approved" }, { quiet: true });
    mergeTestimonials(projectId, b, a);
    const back = restoreTestimonial(b)!;
    expect(back.status).toBe("pending");
    expect(back.text).toBe("Second words, with a highlight");
    expect(listAnswers(a)).toHaveLength(2);
    trashTestimonial(b);
    await deleteTestimonial(b);
    expect(stillUsed(KEY(1))).toBe(true);
    expect(listImages(a)).toHaveLength(1);
  });

  it("INBOX-11 refuses across projects, from or into the trash, after a withdrawal, and into itself", async () => {
    const { a, b } = pair();
    const otherProject = createProject({ name: "Other", slug: "other" }).id;
    const stranger = add({ name: "Ada", text: "Elsewhere" }, otherProject);
    expect(() => mergeTestimonials(projectId, stranger, a)).toThrow(/this project/);
    expect(() => mergeTestimonials(projectId, a, a)).toThrow(/another/);
    const c = add({ name: "Ada", text: "Third" });
    trashTestimonial(c);
    expect(() => mergeTestimonials(projectId, c, a)).toThrow(/trash/);
    withdrawConsent(b, { actor: "customer" });
    expect(() => mergeTestimonials(projectId, b, a)).toThrow(/withdrew/);

    const res = await mergeRoute(
      new Request(`http://localhost/api/admin/projects/${projectId}/testimonials/merge`, { method: "POST", headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ from: b, into: a }) }),
      params({ id: projectId }),
    );
    expect(res.status).toBe(409);
    const cross = await mergeRoute(
      new Request(`http://localhost/api/admin/projects/${otherProject}/testimonials/merge`, { method: "POST", headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ from: c, into: a }) }),
      params({ id: otherProject }),
    );
    expect(cross.status).toBe(404);
  });

  it("INBOX-11 the merge route merges and answers both rows without private hashes", async () => {
    const { a, b } = pair();
    const res = await mergeRoute(
      new Request(`http://localhost/api/admin/projects/${projectId}/testimonials/merge`, { method: "POST", headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ from: b, into: a }) }),
      params({ id: projectId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from.status).toBe("trashed");
    expect("withdrawTokenHash" in body.into).toBe(false);
    expect(getTestimonialDetail(b)!.mergedInto).toMatchObject({ id: a });
  });
});
