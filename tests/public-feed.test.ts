import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { feedAggregate, listFeed } from "@/lib/public-feed";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

type Extra = Partial<typeof schema.testimonials.$inferInsert>;
let clock = Date.UTC(2026, 0, 1);

/** An approved testimonial, one minute newer than the last. */
function add(name: string, o: { rating?: number; text?: string; tags?: string[]; status?: "approved" | "pending" | "rejected"; extra?: Extra } = {}) {
  clock += 60_000;
  const t = createTestimonial(projectId, { name, text: o.text ?? `${name} says hi`, rating: o.rating }, { createdAt: new Date(clock) });
  updateTestimonial(t.id, { status: o.status ?? "approved", ...(o.tags ? { tags: o.tags } : {}) });
  if (o.extra) getDb().update(schema.testimonials).set(o.extra).where(eq(schema.testimonials.id, t.id)).run();
  return t.id;
}

const names = (items: { name: string }[]) => items.map((i) => i.name);

describe("listFeed (widget mode)", () => {
  it("DISP-02 applies the minimum rating in SQL before the limit", () => {
    for (let i = 0; i < 6; i++) add(`Low ${i}`, { rating: 2 });
    add("High A", { rating: 5 });
    add("High B", { rating: 4 });
    for (let i = 0; i < 6; i++) add(`Low later ${i}`, { rating: 3 });
    // The newest 2 overall are low; the filter must still find both high ones.
    const items = listFeed(projectId, { minRating: 4, max: 2 }, { limit: 2 });
    expect(names(items)).toEqual(["High B", "High A"]);
  });

  it("DISP-02 drops withdrawn and unapproved rows in SQL, so the limit is still filled", () => {
    add("Old 1");
    add("Old 2");
    add("Pending", { status: "pending" });
    add("Rejected", { status: "rejected" });
    add("Withdrawn", { extra: { withdrawnAt: new Date() } });
    expect(names(listFeed(projectId, { max: 2 }, { limit: 2 }))).toEqual(["Old 2", "Old 1"]);
  });

  it("DISP-02 filters by tags (any and all), type, keywords, platform, language and form", () => {
    add("Both", { tags: ["home", "pricing"], extra: { platform: "google", language: "en" } });
    add("Home", { tags: ["home"], text: "Great pricing page", extra: { platform: "trustpilot", language: "fr" } });
    add("Video", { extra: { videoKey: "videos/00000000-0000-0000-0000-000000000001.webm", videoMime: "video/webm" } });
    add("Rude", { text: "Terrible support, avoid" });
    const f = (filters: object) => names(listFeed(projectId, filters, { limit: 50 })).sort();
    expect(f({ tags: ["home"] })).toEqual(["Both", "Home"]);
    expect(f({ tags: ["home", "pricing"], tagMode: "all" })).toEqual(["Both"]);
    expect(f({ tags: ["home", "pricing"], tagMode: "any" })).toEqual(["Both", "Home"]);
    expect(f({ type: "video" })).toEqual(["Video"]);
    expect(f({ type: "text" })).toEqual(["Both", "Home", "Rude"]);
    expect(f({ include: ["pricing"] })).toEqual(["Home"]);
    expect(f({ exclude: ["terrible"] })).toEqual(["Both", "Home", "Video"]);
    expect(f({ include: ["100%_"] })).toEqual([]);
    expect(f({ platforms: ["google"] })).toEqual(["Both"]);
    expect(f({ language: "FR" })).toEqual(["Home"]);
    expect(f({ formId: "nope" })).toEqual([]);
  });

  it("DISP-02 sorts newest, oldest and by rating", () => {
    add("A", { rating: 3 });
    add("B", { rating: 5 });
    add("C");
    expect(names(listFeed(projectId, { sort: "newest" }, { limit: 10 }))).toEqual(["C", "B", "A"]);
    expect(names(listFeed(projectId, { sort: "oldest" }, { limit: 10 }))).toEqual(["A", "B", "C"]);
    expect(names(listFeed(projectId, { sort: "rating" }, { limit: 10 }))).toEqual(["B", "A", "C"]);
  });

  it("DISP-02 sort=random is never shuffled or cached on the server: the answer is the same every time", () => {
    for (const n of ["A", "B", "C", "D", "E"]) add(n);
    const first = names(listFeed(projectId, { sort: "random" }, { limit: 10 }));
    expect(first).toEqual(["E", "D", "C", "B", "A"]);
    for (let i = 0; i < 5; i++) expect(names(listFeed(projectId, { sort: "random" }, { limit: 10 }))).toEqual(first);
  });

  it("DISP-01 manual mode keeps the picked order, puts pins first and drops unknown or unapproved ids", () => {
    const a = add("A");
    const b = add("B");
    const c = add("C");
    const p = add("Pending", { status: "pending" });
    const items = listFeed(projectId, {}, { mode: "manual", manualIds: [c, "nope", a, p, b], pinnedIds: [b], limit: 10 });
    expect(names(items)).toEqual(["B", "C", "A"]);
    // An empty pick list shows nothing (not everything).
    expect(listFeed(projectId, {}, { mode: "manual", manualIds: [], limit: 10 })).toEqual([]);
  });

  it("DISP-01 manual picks still honour the filters, and survive a filter change", () => {
    const a = add("A", { rating: 5 });
    const b = add("B", { rating: 3 });
    const picked = [b, a];
    expect(names(listFeed(projectId, { minRating: 4 }, { mode: "manual", manualIds: picked, limit: 10 }))).toEqual(["A"]);
    expect(names(listFeed(projectId, {}, { mode: "manual", manualIds: picked, limit: 10 }))).toEqual(["B", "A"]);
  });

  it("DISP-01 auto mode puts pins first, then the rest up to the limit", () => {
    const a = add("A");
    add("B");
    add("C");
    expect(names(listFeed(projectId, { max: 2 }, { pinnedIds: [a, "missing"], limit: 2 }))).toEqual(["A", "C"]);
  });

  it("DISP-03 first name only is done on the server", () => {
    add("Ada Lovelace", { text: "Lovely" });
    const [item] = listFeed(projectId, {}, { limit: 5, firstNameOnly: true });
    expect(item.name).toBe("Ada");
    expect(JSON.stringify(item)).not.toContain("Lovelace");
  });

  it("DISP-03 feed items carry display extras and never a private field", () => {
    const id = add("Grace", {
      extra: {
        authorEmail: "grace@example.com",
        authorPhone: "+44 7000 000000",
        customFields: '{"plan":"Enterprise"}',
        hiddenFields: '{"utm_source":"ads"}',
        headline: "Fast",
        platform: "google",
        sourceUrl: "javascript:alert(1)",
      },
    });
    const db = getDb();
    db.insert(schema.testimonialImages).values({ id: crypto.randomUUID(), testimonialId: id, key: "images/11111111-1111-1111-1111-111111111111.png", alt: "Screen" }).run();
    db.insert(schema.highlights).values({ id: crypto.randomUUID(), testimonialId: id, start: 0, end: 5, phrase: "Grace" }).run();
    const [item] = listFeed(projectId, {}, { limit: 5 });
    const raw = JSON.stringify(item);
    for (const secret of ["grace@example.com", "7000", "Enterprise", "utm_source", "consent"]) expect(raw).not.toContain(secret);
    expect(raw.toLowerCase()).not.toContain("email");
    expect(item.extra).toMatchObject({
      headline: "Fast",
      platform: "google",
      sourceUrl: null,
      verified: true,
      images: [{ url: "/api/media/images/11111111-1111-1111-1111-111111111111.png", alt: "Screen" }],
      highlights: [{ start: 0, end: 5 }],
    });
  });
});

describe("feedAggregate", () => {
  it("DISP-07 counts and averages before the limit, filtered or for all", () => {
    add("A", { rating: 5 });
    add("B", { rating: 4 });
    add("C", { rating: 2 });
    add("D");
    add("Hidden", { rating: 1, status: "pending" });
    expect(listFeed(projectId, { max: 1 }, { limit: 1 })).toHaveLength(1);
    expect(feedAggregate(projectId, { max: 1 })).toEqual({ count: 4, average: 3.7 });
    expect(feedAggregate(projectId, { minRating: 4 })).toEqual({ count: 2, average: 4.5 });
    expect(feedAggregate(projectId, { minRating: 4 }, { scope: "all" })).toEqual({ count: 4, average: 3.7 });
    expect(feedAggregate(projectId, {}, { mode: "manual", manualIds: [] })).toEqual({ count: 0, average: null });
  });
});
