import { describe, expect, it } from "vitest";
import { x } from "@/lib/importers/sources/x";
import { ImporterInputError } from "@/lib/importers/types";
import { fakeCtx } from "./_ctx";

const input = x.input.parse({
  urls: "https://x.com/janedev/status/1844000000000000001\nhttps://twitter.com/sam_k/status/1844000000000000002?s=20\nhttps://x.com/janedev/status/1844000000000000001",
}) as { posts: { handle: string; id: string }[] };

describe("IMP-01 X importer", () => {
  it("IMP-01 takes post links, one per line, without repeats", () => {
    expect(input.posts).toEqual([
      { handle: "janedev", id: "1844000000000000001" },
      { handle: "sam_k", id: "1844000000000000002" },
    ]);
    expect(x.input.safeParse({ urls: "https://x.com/janedev" }).success).toBe(false);
  });

  it("IMP-01 reads each post through oEmbed with the injected fetch", async () => {
    const { ctx, calls } = fakeCtx({ "1844000000000000001": { file: "x/oembed-1.json" }, "1844000000000000002": { file: "x/oembed-2.json" } });
    const page = await x.fetchPage(input, null, ctx);
    expect(calls[0].url).toBe(`https://publish.twitter.com/oembed?url=${encodeURIComponent("https://twitter.com/janedev/status/1844000000000000001")}&omit_script=true&dnt=true`);
    expect(page.items[0]).toEqual({
      sourceReviewId: "1844000000000000001",
      authorName: "Jane Dev",
      authorTitle: "@janedev",
      text: "Switched our onboarding to @acme and support tickets halved. Wild.",
      language: "en",
      url: "https://x.com/janedev/status/1844000000000000001",
      date: { value: new Date(Date.UTC(2026, 9, 9)), precision: "day" },
    });
    expect(page.items[1]).toMatchObject({ authorName: "Sam K", language: "de" });
    expect(page.next).toBeNull();
  });

  it("IMP-01 leaves out deleted posts, and says so when none can be read", async () => {
    const one = await x.fetchPage(input, null, fakeCtx({ "1844000000000000002": { file: "x/oembed-2.json" } }).ctx);
    expect(one.items).toHaveLength(1);
    await expect(x.fetchPage(input, null, fakeCtx({}).ctx)).rejects.toBeInstanceOf(ImporterInputError);
  });
});
