import { describe, expect, it } from "vitest";
import { capterra } from "@/lib/importers/sources/capterra";
import { ImporterBlockedError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

describe("IMP-01 Capterra importer", () => {
  it("IMP-01 needs the product's Capterra page", () => {
    expect(capterra.input.parse({ url: "https://www.capterra.com/p/123456/AcmeWidgets/reviews/" })).toEqual({ id: "123456", slug: "AcmeWidgets" });
    expect(capterra.input.safeParse({ url: "acme" }).success).toBe(false);
  });

  it("IMP-01 reads the JSON-LD reviews through the injected fetch", async () => {
    const { ctx, calls } = fakeCtx({ "/p/123456/AcmeWidgets/reviews/": { file: "capterra/reviews.html" } });
    const page = await capterra.fetchPage({ id: "123456", slug: "AcmeWidgets" }, null, ctx);
    expect(calls[0].url).toBe("https://www.capterra.com/p/123456/AcmeWidgets/reviews/");
    expect(page.items[0]).toMatchObject({ authorName: "Dana R.", authorTitle: "Operations lead", rating: 5, headline: "Saved us hours" });
    expect(page.items[1]).toMatchObject({ authorName: "Eli W.", rating: 3 });
    // No ids on the page: a stable hash, the same on every read.
    expect(page.items[1].sourceReviewId).toBe(capterra.parseHtml!(fixture("capterra/reviews.html"))[1].sourceReviewId);
  });

  it("IMP-01 a page with no reviews (or a wall) is blocked", async () => {
    await expect(capterra.fetchPage({ id: "1", slug: "x" }, null, fakeCtx({ "/p/": { text: "<html><body>Nothing</body></html>" } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
  });
});
