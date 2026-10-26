import { describe, expect, it } from "vitest";
import { testimonialTo } from "@/lib/importers/sources/testimonial-to";
import { ImporterBlockedError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

describe("IMP-01 Testimonial.to migration", () => {
  it("IMP-01 needs a Wall of Love link on testimonial.to", () => {
    expect(testimonialTo.input.parse({ url: "https://testimonial.to/acme/all" })).toEqual({ space: "acme" });
    expect(testimonialTo.input.parse({ url: "testimonial.to/acme" })).toEqual({ space: "acme" });
    expect(testimonialTo.input.safeParse({ url: "https://evil.example/acme" }).success).toBe(false);
  });

  it("IMP-01 reads the wall's text and video testimonials through the injected fetch", async () => {
    const { ctx, calls } = fakeCtx({ "/acme/all": { file: "testimonial-to/wall.html" } });
    const page = await testimonialTo.fetchPage({ space: "acme" }, null, ctx);
    expect(calls[0].url).toBe("https://testimonial.to/acme/all");
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toMatchObject({ sourceReviewId: "tt-1", authorName: "Rosa Diaz", authorTitle: "Product designer", authorCompany: "Studio Nine", rating: 5, avatarUrl: "https://tt-fixture.example/rosa.png" });
    expect(page.items[1]).toMatchObject({ sourceReviewId: "tt-2", videoUrl: "https://tt-fixture.example/ken.mp4" });
    expect(page.items[2].date).toEqual({ value: new Date(Date.UTC(2026, 8, 1)), precision: "month" });
    await expect(testimonialTo.fetchPage({ space: "acme" }, null, fakeCtx({ "/acme/": { text: "<html></html>" } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
  });

  it("IMP-01 reads the CSV export with the mapper's preset", () => {
    const items = testimonialTo.parseFile!(fixture("testimonial-to/export.csv"));
    expect(items.map((i) => i.sourceReviewId)).toEqual(["tt-1", "tt-9"]);
    expect(items[0]).toMatchObject({ authorName: "Rosa Diaz", authorTitle: "Product designer", rating: 5, text: "Collecting reviews used to take weeks." });
  });
});
