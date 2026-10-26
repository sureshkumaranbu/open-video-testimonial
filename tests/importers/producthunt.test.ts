import { afterEach, describe, expect, it } from "vitest";
import { producthunt } from "@/lib/importers/sources/producthunt";
import { ImporterBlockedError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

afterEach(() => {
  delete process.env.PRODUCT_HUNT_TOKEN;
});

describe("IMP-01 Product Hunt importer", () => {
  it("IMP-01 reads a launch's comments through GraphQL v2 with your own token, page by page", async () => {
    process.env.PRODUCT_HUNT_TOKEN = "ph-token";
    const { ctx, calls } = fakeCtx({
      "/v2/api/graphql": (_url, o) => ({ file: JSON.parse(o.body!).variables.after ? "producthunt/comments-page2.json" : "producthunt/comments-page1.json" }),
    });
    const input = producthunt.input.parse({ url: "https://www.producthunt.com/posts/acme-launch" });
    const one = await producthunt.fetchPage(input, null, ctx);
    expect(calls[0].url).toBe("https://api.producthunt.com/v2/api/graphql");
    expect(calls[0].o.headers).toMatchObject({ authorization: "Bearer ph-token" });
    expect(JSON.parse(calls[0].o.body!).variables).toEqual({ slug: "acme-launch", after: null });
    expect(one.items).toHaveLength(20);
    expect(one.items[0]).toMatchObject({ sourceReviewId: "3000000", authorName: "Maker Friend 1", authorTitle: "Founder at Example Co" });
    expect(one.items[0].text).toBe("Congrats on the launch! We've used it for 2 weeks & love it.");
    expect(one.next).toBe("Y3Vyc29yMjA=");
    const two = await producthunt.fetchPage(input, one.next, ctx);
    expect(two.items).toHaveLength(5);
    expect(two.next).toBeNull();
  });

  it("IMP-01 without a token it reads the public reviews page, or asks for the saved page", async () => {
    const input = producthunt.input.parse({ url: "https://www.producthunt.com/products/acme" });
    const { ctx, calls } = fakeCtx({ "/products/acme/reviews": { file: "producthunt/reviews.html" } });
    const page = await producthunt.fetchPage(input, null, ctx);
    expect(calls[0].url).toBe("https://www.producthunt.com/products/acme/reviews");
    expect(page.items[0]).toMatchObject({ sourceReviewId: "ph-review-9001", authorName: "Kim Lee", rating: 5 });
    await expect(producthunt.fetchPage(input, null, fakeCtx({ "/products/": { status: 403 } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
    expect(producthunt.parseHtml!(fixture("producthunt/reviews.html"))).toHaveLength(1);
  });
});
