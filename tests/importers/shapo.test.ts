import { describe, expect, it } from "vitest";
import { shapo } from "@/lib/importers/sources/shapo";
import { ImporterInputError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

const fifty = (start: number) =>
  JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ _id: `id-${start + i}`, name: `Person ${start + i}`, message: "Kind words.", rating: 5 })));

describe("IMP-01 Shapo migration", () => {
  it("IMP-01 reads testimonials through the API with your own key", async () => {
    const { ctx, calls } = fakeCtx({ "/testimonials": { file: "shapo/api-page0.json" } });
    const page = await shapo.fetchPage({ apiKey: "shapo-key-123" }, null, ctx);
    expect(calls[0].url).toBe("https://api.shapo.io/testimonials?size=50&page=0&sort=newest");
    expect(calls[0].o.headers).toMatchObject({ authorization: "Bearer shapo-key-123" });
    expect(page.next).toBeNull();
    expect(page.items[0]).toMatchObject({ sourceReviewId: "64aa00000000000000000001", authorName: "Maya Lind", authorTitle: "Owner", authorCompany: "Lind Florist", platform: "google", url: "https://maps.google.com/?cid=2" });
    // Shapo's own form isn't a review site, and a video link comes across.
    expect(page.items[1]).toMatchObject({ platform: undefined, videoUrl: "https://shapo-fixture.example/owen.mp4" });
  });

  it("IMP-01 pages from 0, skipping a page that repeats the one before", async () => {
    // A 1-based API answers page 0 and page 1 with the same items.
    const { ctx } = fakeCtx({ "page=0&": { text: fifty(0) }, "page=1&": { text: fifty(0) }, "page=2&": { text: JSON.stringify([{ _id: "last", name: "Last", message: "End." }]) } });
    const p0 = await shapo.fetchPage({ apiKey: "shapo-key-123" }, null, ctx);
    expect(p0.items).toHaveLength(50);
    const p1 = await shapo.fetchPage({ apiKey: "shapo-key-123" }, p0.next, ctx);
    expect(p1.items).toHaveLength(0);
    const p2 = await shapo.fetchPage({ apiKey: "shapo-key-123" }, p1.next, ctx);
    expect(p2.items.map((i) => i.sourceReviewId)).toEqual(["last"]);
    expect(p2.next).toBeNull();
  });

  it("IMP-01 a refused key says so; the CSV export maps with the preset", async () => {
    await expect(shapo.fetchPage({ apiKey: "shapo-key-123" }, null, fakeCtx({ "/testimonials": { status: 403, text: "{}" } }).ctx)).rejects.toBeInstanceOf(ImporterInputError);
    const items = shapo.parseFile!(fixture("shapo/export.csv"));
    expect(items).toEqual([
      expect.objectContaining({ sourceReviewId: "64aa00000000000000000001", authorName: "Maya Lind", platform: "google", avatarUrl: "https://shapo-fixture.example/maya.jpg", text: "They rebuilt our reviews page in an afternoon." }),
      expect.objectContaining({ sourceReviewId: "64aa00000000000000000003", platform: "trustpilot", rating: 3 }),
    ]);
  });
});
