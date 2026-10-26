import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { DEFAULT_QUERY, inboxCounts, queryTestimonials } from "@/lib/inbox";
import { createProject } from "@/lib/testimonials";
import { useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

const WORDS = ["fast", "friendly", "support", "pricing", "onboarding", "reliable", "simple", "dashboard", "team", "value", "setup", "docs"];
/** 200 ms locally (INBOX-02); CI machines get twice that. */
const BUDGET_MS = process.env.CI ? 400 : 200;

beforeAll(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Big", slug: "big" }).id;
  const db = getDb();
  const tag = { id: crypto.randomUUID(), projectId, name: "pricing" };
  db.insert(schema.tags).values(tag).run();
  const now = Date.now();
  // 10,000 rows in one transaction; the search triggers index each one.
  db.transaction((tx) => {
    for (let i = 0; i < 10_000; i++) {
      const id = crypto.randomUUID();
      const text = Array.from({ length: 30 }, (_, j) => WORDS[(i * 7 + j * 3) % WORDS.length]).join(" ") + ` row${i}`;
      tx.insert(schema.testimonials)
        .values({
          id,
          projectId,
          status: i % 3 === 0 ? "approved" : "pending",
          rating: (i % 5) + 1,
          text,
          authorName: `Person ${i}`,
          authorEmail: `p${i}@example.com`,
          consentAt: new Date(now - i * 1000),
          createdAt: new Date(now - i * 1000),
          updatedAt: new Date(now - i * 1000),
          videoKey: i % 4 === 1 ? `videos/${id}.webm` : null,
          wordCount: 31,
        })
        .run();
      if (i % 10 === 3) tx.insert(schema.testimonialTags).values({ testimonialId: id, tagId: tag.id }).run();
    }
  });
});
afterAll(() => ctx.cleanup());

function timed<T>(fn: () => T) {
  fn(); // warm the statement cache once
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}

describe("INBOX-02 search speed", () => {
  it("INBOX-02 a search over 10k rows, with its counts, answers in under 200 ms", () => {
    const { result, ms } = timed(() => {
      const q = { ...DEFAULT_QUERY, tab: "all" as const, q: "pricing support" };
      return { page: queryTestimonials(projectId, q), counts: inboxCounts(projectId, q) };
    });
    console.log(`inbox search over 10k rows: ${ms.toFixed(1)} ms (budget ${BUDGET_MS} ms)`);
    expect(result.page.total).toBeGreaterThan(100);
    expect(result.page.items).toHaveLength(25);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("INBOX-03 filters, a rare word and a sort over 10k rows also stay under budget", () => {
    const { result, ms } = timed(() =>
      queryTestimonials(projectId, { ...DEFAULT_QUERY, tab: "all", q: "row9999", rating: [4, 5], sort: "rating" }),
    );
    console.log(`rare word search: ${ms.toFixed(1)} ms`);
    expect(result.total).toBe(1);
    expect(ms).toBeLessThan(BUDGET_MS);
    const filtered = timed(() =>
      queryTestimonials(projectId, { ...DEFAULT_QUERY, tab: "all", rating: [4, 5], tags: ["pricing"], type: "video", sort: "rating" }),
    );
    console.log(`filters without search: ${filtered.ms.toFixed(1)} ms`);
    expect(filtered.result.total).toBeGreaterThan(0);
    expect(filtered.ms).toBeLessThan(BUDGET_MS);
  });
});
