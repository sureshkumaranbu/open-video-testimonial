import { describe, expect, it } from "vitest";
import { senja } from "@/lib/importers/sources/senja";
import { ImporterInputError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

describe("IMP-01 Senja migration", () => {
  it("IMP-01 reads testimonials through the API with your own key, videos included", async () => {
    const { ctx, calls } = fakeCtx({ "/v1/testimonials": { file: "senja/api-page1.json" } });
    const page = await senja.fetchPage({ apiKey: "senja-key-123" }, null, ctx);
    expect(calls[0].url).toBe("https://api.senja.io/v1/testimonials?limit=50&page=1&sort=date&order=desc");
    expect(calls[0].o.headers).toMatchObject({ authorization: "Bearer senja-key-123" });
    expect(page.next).toBeNull();
    expect(page.items.map((i) => i.sourceReviewId)).toEqual(["sj_001", "sj_002", "sj_003"]);
    expect(page.items[0]).toMatchObject({
      authorName: "Grace Ito",
      authorTitle: "Head of Growth",
      authorCompany: "Ito Labs",
      headline: "Changed how we onboard",
      videoUrl: "https://cdn.senja-fixture.example/grace.mp4",
      avatarUrl: "https://cdn.senja-fixture.example/grace.png",
      platform: undefined,
    });
    // Where it was first posted comes across as the platform.
    expect(page.items[1].platform).toBe("google");
    expect(page.items[2].platform).toBe("producthunt");
  });

  it("IMP-05 Senja's stand-in 22nd for month-only dates becomes the month", async () => {
    const { ctx } = fakeCtx({ "/v1/testimonials": { file: "senja/api-page1.json" } });
    const page = await senja.fetchPage({ apiKey: "senja-key-123" }, null, ctx);
    expect(page.items[1].date).toEqual({ value: new Date(Date.UTC(2026, 8, 1)), precision: "month" });
    expect(page.items[0].date?.precision).toBe("day");
  });

  it("IMP-01 a refused key says to check it; the CSV export works without one", async () => {
    await expect(senja.fetchPage({ apiKey: "senja-key-123" }, null, fakeCtx({ "/v1/": { status: 401, text: "{}" } }).ctx)).rejects.toBeInstanceOf(ImporterInputError);
    // The header row and value formats are copied from a real Senja export (2026-10-27).
    const items = senja.parseFile!(fixture("senja/export.csv"));
    expect(items[0]).toMatchObject({
      authorName: "Grace Ito",
      // customer_tagline is the person's title; Senja's plain "title" column is the headline.
      authorTitle: "Head of Growth",
      authorCompany: "Ito Labs",
      headline: "Changed how we onboard",
      videoUrl: "https://cdn.senja-fixture.example/grace.mp4",
      avatarUrl: "https://cdn.senja-fixture.example/grace.png",
      rating: 5,
      date: { value: new Date("2026-10-12T14:00:00.512Z"), precision: "day" },
    });
    // No id column: a stable hash, so the same file imported twice dedupes.
    expect(items[0].sourceReviewId).toMatch(/^h_/);
    // A review Senja imported from Google keeps Google's id, and the 22nd-at-midnight stand-in becomes the month.
    expect(items[1]).toMatchObject({ authorName: "Leo Marsh", authorTitle: undefined, platform: "google", sourceReviewId: "ChZDSUhNMG9nS0VJQ0FnSUNmeE5uMEZBEAE", date: { precision: "month" } });
    expect(senja.parseFile!(fixture("senja/export.csv")).map((i) => i.sourceReviewId)).toEqual(items.map((i) => i.sourceReviewId));
  });
});
