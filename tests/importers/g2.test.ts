import { describe, expect, it } from "vitest";
import { g2 } from "@/lib/importers/sources/g2";
import { ImporterBlockedError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

describe("IMP-01 G2 importer", () => {
  it("IMP-01 takes the product page or its slug", () => {
    expect(g2.input.parse({ url: "https://www.g2.com/products/acme-widgets/reviews?page=2" })).toEqual({ slug: "acme-widgets" });
    expect(g2.input.parse({ url: "acme-widgets" })).toEqual({ slug: "acme-widgets" });
    expect(g2.input.safeParse({ url: "https://example.com/x" }).success).toBe(false);
  });

  it("IMP-01 reads microdata reviews through the injected fetch, 10-point ratings as stars", async () => {
    const { ctx, calls } = fakeCtx({ "/products/acme-widgets/reviews": { file: "g2/reviews.html" } });
    const page = await g2.fetchPage({ slug: "acme-widgets" }, null, ctx);
    expect(calls[0].url).toBe("https://www.g2.com/products/acme-widgets/reviews");
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ sourceReviewId: "survey-response-1001", authorName: "Priya N.", rating: 5, headline: "\"Our whole team uses it daily\"" });
    expect(page.items[0].text).toBe("What do you like best? The dashboards.\n\nWhat do you dislike? Nothing so far.");
    expect(page.items[1]).toMatchObject({ authorName: "Jonas K.", rating: 4, date: { precision: "month" } });
  });

  it("IMP-01 blocked pages ask for the saved page, which parses the same way", async () => {
    await expect(g2.fetchPage({ slug: "acme-widgets" }, null, fakeCtx({ "/products/": { status: 403 } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
    expect(g2.parseHtml!(fixture("g2/reviews.html"))).toHaveLength(2);
  });
});
