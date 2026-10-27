import { describe, expect, it } from "vitest";
import { sanitizeItem } from "@/lib/importers/run";
import { trustpilot } from "@/lib/importers/sources/trustpilot";
import { ImporterBlockedError, ImporterInputError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

const input = (url: string) => trustpilot.input.parse({ url });

describe("IMP-01 Trustpilot importer", () => {
  it("IMP-01 accepts the business page or a bare domain", () => {
    expect(input("https://uk.trustpilot.com/review/acme.example?page=3")).toEqual({ domain: "acme.example" });
    expect(input("www.acme.example/about")).toEqual({ domain: "acme.example" });
    expect(trustpilot.input.safeParse({ url: "not a domain" }).success).toBe(false);
  });

  it("IMP-01 reads the JSON-LD reviews page by page through the injected fetch", async () => {
    const { ctx, calls } = fakeCtx({ "page=2": { file: "trustpilot/page2.html" }, "/review/acme.example": { file: "trustpilot/business-page.html" } });
    const first = await trustpilot.fetchPage(input("acme.example"), null, ctx);
    expect(calls[0].url).toBe("https://www.trustpilot.com/review/acme.example");
    expect(first.items.map((r) => r.sourceReviewId)).toEqual(["6a00000000000000000000a1", "6a00000000000000000000a2", "6a00000000000000000000a3"]);
    expect(first.items[0]).toMatchObject({ authorName: "Rowan Field", rating: 5, headline: "Fast and friendly", language: "en", date: { precision: "day" } });
    expect(first.items[0].text).toBe("Ordered on Monday, arrived on Tuesday. Lovely people & great support.");
    expect(first.items[1].text).toBe("The app is good\nbut the setup took a while.");
    expect(first.next).toBe("2");
    const second = await trustpilot.fetchPage(input("acme.example"), first.next, ctx);
    expect(calls[1].url).toBe("https://www.trustpilot.com/review/acme.example?page=2");
    expect(second.items).toHaveLength(2);
    expect(second.next).toBeNull();
  });

  it("IMP-01 imported text never carries markup or scripts", async () => {
    const { ctx } = fakeCtx({ "/review/": { file: "trustpilot/business-page.html" } });
    const { items } = await trustpilot.fetchPage(input("acme.example"), null, ctx);
    const sam = sanitizeItem(items[2], trustpilot)!;
    expect(sam.authorName).toBe("Sam");
    expect(sam.text).toBe("Five stars from me.");
  });

  it("IMP-01 a bot wall is reported as blocked, a missing page as an input problem", async () => {
    await expect(trustpilot.fetchPage(input("acme.example"), null, fakeCtx({ "/review/": { status: 403, text: "no" } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
    await expect(trustpilot.fetchPage(input("acme.example"), null, fakeCtx({ "/review/": { file: "trustpilot/blocked.html" } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
    await expect(trustpilot.fetchPage(input("acme.example"), null, fakeCtx({}).ctx)).rejects.toBeInstanceOf(ImporterInputError);
  });

  it("IMP-05 the saved-page upload reads the embedded data, keeps a month-only date and drops unsafe links", () => {
    const items = trustpilot.parseHtml!(fixture("trustpilot/saved-page.html"));
    expect(items.map((r) => r.sourceReviewId)).toEqual(["6a00000000000000000000b1", "6a00000000000000000000b2", "6a00000000000000000000a1"]);
    expect(items[1].date).toEqual({ value: new Date(Date.UTC(2026, 9, 1)), precision: "month" });
    expect(items[0].avatarUrl).toBe("https://user-images.example/lena.png");
    expect(items[2].avatarUrl).toBeUndefined();
  });
});
