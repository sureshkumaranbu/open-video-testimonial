import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { createProject, createTestimonial, deleteTestimonial, updateTestimonial } from "@/lib/testimonials";
import { useTempDataDir } from "./helpers";

/**
 * Migration 0010 keeps testimonial_search (one body per testimonial) and the
 * testimonials_fts index current with triggers, so every write path is
 * covered, including the ones that bypass updateTestimonial.
 */

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

/** Testimonial ids whose search body matches `word` (as a quoted FTS token). */
function search(word: string) {
  return getDb()
    .all<{ id: string }>(
      sql`SELECT s.testimonial_id AS id FROM testimonials_fts JOIN testimonial_search s ON s.id = testimonials_fts.rowid
          WHERE testimonials_fts MATCH ${`"${word}"`} ORDER BY s.testimonial_id`,
    )
    .map((r) => r.id);
}

const body = (testimonialId: string) =>
  getDb().select({ body: schema.testimonialSearch.body }).from(schema.testimonialSearch).where(eq(schema.testimonialSearch.testimonialId, testimonialId)).get()?.body;

/** Documents in the FTS index itself (not the content table). */
const indexed = () => getDb().get<{ n: number }>(sql`SELECT count(*) AS n FROM testimonials_fts_docsize`)!.n;

/** FTS5's own check that the index matches testimonial_search row for row; throws if not. */
function expectIndexInSync() {
  expect(() => getDb().run(sql`INSERT INTO testimonials_fts(testimonials_fts, rank) VALUES ('integrity-check', 1)`)).not.toThrow();
}

function addAnswer(testimonialId: string, questionKey: string, text: string) {
  const now = new Date();
  return getDb()
    .insert(schema.answers)
    .values({ id: crypto.randomUUID(), testimonialId, questionKey, questionTitle: "What else?", position: 2, text, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

describe("the inbox search index", () => {
  it("indexes a new testimonial: author, email, company, title and text", () => {
    const t = createTestimonial(projectId, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      company: "Analytical Engines",
      title: "Mathematician",
      text: "Remarkably quick onboarding.",
    });
    for (const word of ["remarkably", "lovelace", "ada@example.com", "analytical", "mathematician"]) {
      expect(search(word), word).toEqual([t.id]);
    }
    expect(indexed()).toBe(1);
    expectIndexInSync();
  });

  it("follows edits to the text, transcript, author and headline, ignoring case and accents", () => {
    const t = createTestimonial(projectId, { name: "Grace", text: "Remarkably quick." });
    updateTestimonial(t.id, { text: "Wonderful café support", authorName: "Grace Hopper" });
    expect(search("remarkably")).toEqual([]);
    expect(search("wonderful")).toEqual([t.id]);
    expect(search("CAFE")).toEqual([t.id]);
    expect(search("hopper")).toEqual([t.id]);

    // Transcripts are written straight to the row by the transcription job.
    getDb().update(schema.testimonials).set({ transcript: "Spoken praise about latency", headline: "Fastest tool we use" }).where(eq(schema.testimonials.id, t.id)).run();
    expect(search("latency")).toEqual([t.id]);
    expect(search("fastest")).toEqual([t.id]);
    expect(indexed()).toBe(1);
    expectIndexInSync();
  });

  it("follows tags being added, renamed and removed", () => {
    const t = createTestimonial(projectId, { name: "Lin", text: "Good value." });
    const other = createTestimonial(projectId, { name: "Max", text: "Also good." });
    updateTestimonial(t.id, { tags: ["pricing", "homepage"] });
    updateTestimonial(other.id, { tags: ["pricing"] });
    expect(search("pricing")).toEqual([t.id, other.id].sort());
    expect(search("homepage")).toEqual([t.id]);

    getDb().update(schema.tags).set({ name: "billing" }).where(eq(schema.tags.name, "pricing")).run();
    expect(search("pricing")).toEqual([]);
    expect(search("billing")).toEqual([t.id, other.id].sort());

    updateTestimonial(t.id, { tags: [] });
    expect(search("billing")).toEqual([other.id]);
    expect(search("homepage")).toEqual([]);
    expectIndexInSync();
  });

  it("follows answers being added, edited and deleted", () => {
    const t = createTestimonial(projectId, { name: "Ola", text: "Main answer." });
    const answer = addAnswer(t.id, "q2", "The zebra crossing feature");
    expect(search("zebra")).toEqual([t.id]);

    getDb().update(schema.answers).set({ text: "The giraffe feature" }).where(eq(schema.answers.id, answer.id)).run();
    expect(search("zebra")).toEqual([]);
    expect(search("giraffe")).toEqual([t.id]);

    getDb().delete(schema.answers).where(eq(schema.answers.id, answer.id)).run();
    expect(search("giraffe")).toEqual([]);
    expect(search("main")).toEqual([t.id]);
    expectIndexInSync();
  });

  it("drops a deleted testimonial, with its tags and answers, without blocking the delete", async () => {
    const t = createTestimonial(projectId, { name: "Del", text: "Soon gone." });
    const kept = createTestimonial(projectId, { name: "Kay", text: "Staying put." });
    updateTestimonial(t.id, { tags: ["pricing"] });
    addAnswer(t.id, "q2", "An extra answer");

    expect(await deleteTestimonial(t.id)).toBe(true);
    expect(body(t.id)).toBeUndefined();
    expect(search("gone")).toEqual([]);
    expect(search("pricing")).toEqual([]);
    expect(search("staying")).toEqual([kept.id]);
    expect(indexed()).toBe(1);
    expectIndexInSync();
  });

  it("drops everything of a deleted project and nothing of another", () => {
    const beta = createProject({ name: "Beta", slug: "beta" }).id;
    const a = createTestimonial(projectId, { name: "A", text: "Acme words." });
    const b = createTestimonial(beta, { name: "B", text: "Beta words." });
    updateTestimonial(a.id, { tags: ["pricing"] });
    addAnswer(a.id, "q2", "Acme answer");

    getDb().delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
    expect(getDb().select().from(schema.testimonialSearch).all().map((r) => r.testimonialId)).toEqual([b.id]);
    expect(search("words")).toEqual([b.id]);
    expect(indexed()).toBe(1);
    expectIndexInSync();
  });

  it("leaves the index alone on media, status and transcript-status writes", () => {
    const t = createTestimonial(projectId, { name: "Mia", text: "Video person." });
    // A marker body: if any body trigger ran, it would put the real body back.
    getDb().run(sql`UPDATE testimonial_search SET body = 'untouched-marker' WHERE testimonial_id = ${t.id}`);
    getDb()
      .update(schema.testimonials)
      .set({
        videoKey: "videos/11111111-1111-4111-8111-111111111111.mp4",
        posterKey: "images/22222222-2222-4222-8222-222222222222.jpg",
        mediaStatus: "ready",
        videoDurationMs: 4000,
        transcriptStatus: "queued",
        status: "approved",
        approvedBy: "owner",
        updatedAt: new Date(),
      })
      .where(eq(schema.testimonials.id, t.id))
      .run();
    updateTestimonial(t.id, { status: "rejected" });
    expect(body(t.id)).toBe("untouched-marker");
    expect(search("untouched")).toEqual([t.id]);

    // A real edit brings the body back.
    updateTestimonial(t.id, { text: "Video person, edited." });
    expect(body(t.id)).toMatch(/^Mia\s+Video person, edited\.$/);
    expect(search("untouched")).toEqual([]);
    expectIndexInSync();
  });
});
