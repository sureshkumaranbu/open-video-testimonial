import { describe, expect, it } from "vitest";
import { decodeUpload } from "@/lib/importers/html";
import { googleplay } from "@/lib/importers/sources/googleplay";
import { ImporterBlockedError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

/** The Play Console writes its reports as UTF-16 with a byte-order mark. */
function utf16(text: string) {
  const body = Buffer.from(text, "utf16le");
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
}

describe("IMP-01 Google Play importer", () => {
  it("IMP-01 takes the store link or the package name", () => {
    expect(googleplay.input.parse({ app: "https://play.google.com/store/apps/details?id=com.example.acmenotes&hl=en" })).toEqual({ pkg: "com.example.acmenotes" });
    expect(googleplay.input.parse({ app: "com.example.acmenotes" })).toEqual({ pkg: "com.example.acmenotes" });
    expect(googleplay.input.safeParse({ app: "acme" }).success).toBe(false);
  });

  it("IMP-01 reads the reviews on the store page through the injected fetch (best effort)", async () => {
    const { ctx, calls } = fakeCtx({ "/store/apps/details": { file: "googleplay/store-page.html" } });
    const page = await googleplay.fetchPage({ pkg: "com.example.acmenotes" }, null, ctx);
    expect(calls[0].url).toBe("https://play.google.com/store/apps/details?id=com.example.acmenotes&hl=en&gl=US");
    expect(page.items).toEqual([
      expect.objectContaining({ sourceReviewId: "gp:AOqpTOFsynthetic0001", authorName: "Hana Sato", rating: 5, text: "Clean, fast and the widgets are lovely. Syncs with my tablet too.", avatarUrl: "https://play-lh.example/avatar1.png" }),
      expect.objectContaining({ sourceReviewId: "gp:AOqpTOFsynthetic0002", authorName: "Tom Reyes", rating: 3, text: "Good app but the backup is slow." }),
    ]);
    expect(page.items[0].date).toEqual({ value: new Date("October 12, 2026"), precision: "day" });
    await expect(googleplay.fetchPage({ pkg: "com.example.acmenotes" }, null, fakeCtx({ "/store/": { text: "<html><body>No reviews here</body></html>" } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
  });

  it("IMP-01 reads the Play Console reviews report, UTF-16 and all", () => {
    const text = decodeUpload(utf16(fixture("googleplay/reviews-report.csv")));
    const items = googleplay.parseFile!(text);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ sourceReviewId: "gp:AOqpTOFreport0001", authorName: "Google Play user", rating: 5, text: 'Love it, "best" notes app.', language: "en", authorTitle: "On pixel8" });
    expect(items[0].date).toEqual({ value: new Date(1791792000000), precision: "day" });
    expect(items[1].text).toBe("Très pratique.");
    // No link: a stable hash, the same each time.
    expect(items[2].sourceReviewId).toBe(googleplay.parseFile!(text)[2].sourceReviewId);
    expect(() => googleplay.parseFile!("a,b\n1,2")).toThrow(/Play Console/);
  });
});
