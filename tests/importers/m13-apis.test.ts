import { afterEach, describe, expect, it } from "vitest";
import { sanitizeItem } from "@/lib/importers/run";
import { listImporters, canSync, getAdapter } from "@/lib/importers/registry";
import { applepodcasts } from "@/lib/importers/sources/applepodcasts";
import { etsy } from "@/lib/importers/sources/etsy";
import { feefo } from "@/lib/importers/sources/feefo";
import { reddit } from "@/lib/importers/sources/reddit";
import { woocommerce } from "@/lib/importers/sources/woocommerce";
import { wordpress } from "@/lib/importers/sources/wordpress";
import { videoId, youtube } from "@/lib/importers/sources/youtube";
import { ImporterBlockedError, ImporterInputError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

/** M13's sources that read an official API or a public feed (PRD §8.2 P1). */

afterEach(() => {
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.ETSY_API_KEY;
  delete process.env.PLAUDIT_FEATURES;
});

describe("IMP-01 M13 sources in the registry", () => {
  it("IMP-01 IMP-03 every new source has a method, terms, an icon and is listed only with imports2", async () => {
    const fs = await import("node:fs");
    const ids = ["yelp", "facebook", "linkedin", "youtube", "reddit", "tripadvisor", "appsumo", "udemy", "shopify", "woocommerce", "etsy", "amazon", "clutch", "fiverr", "airbnb", "zillow", "realtor", "chromewebstore", "wordpress", "applepodcasts", "feefo", "trustindex"];
    const listed = listImporters();
    for (const id of ids) {
      const info = listed.find((i) => i.id === id)!;
      expect(info, id).toBeTruthy();
      expect(info.tosNotes.length, id).toBeGreaterThan(40);
      expect(fs.existsSync(`public/importers/${id}.svg`), id).toBe(true);
    }
    // Saved-page-only sources take no input and can't be kept in sync.
    for (const id of ["yelp", "facebook", "linkedin", "tripadvisor", "amazon", "fiverr", "airbnb", "zillow", "realtor", "chromewebstore", "trustindex"]) {
      const info = listed.find((i) => i.id === id)!;
      expect(info).toMatchObject({ method: "saved-page", savedPageOnly: true, acceptsHtml: true, canSync: false, fields: [] });
    }
    expect(canSync(getAdapter("woocommerce")!)).toBe(true);
    expect(canSync(getAdapter("senja")!)).toBe(false);
    process.env.PLAUDIT_FEATURES = "importers";
    expect(listImporters().map((i) => i.id)).toEqual(["google", "trustpilot", "g2", "capterra", "producthunt", "appstore", "googleplay", "x", "testimonial-to", "senja", "shapo"]);
  });
});

describe("IMP-01 YouTube importer", () => {
  it("IMP-01 reads watch, short, embed and youtu.be links", () => {
    expect(videoId("https://www.youtube.com/watch?v=abcdefghijk&t=5")).toBe("abcdefghijk");
    expect(videoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(videoId("https://www.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
    expect(videoId("https://evil.example/watch?v=abcdefghijk")).toBeNull();
    expect(youtube.input.safeParse({ urls: "https://example.com/x" }).success).toBe(false);
  });

  it("IMP-01 without a key, each video imports as itself through oEmbed", async () => {
    const { ctx, calls } = fakeCtx({ "/oembed": { file: "youtube/oembed.json", contentType: "application/json" } });
    const page = await youtube.fetchPage(youtube.input.parse({ urls: "https://youtu.be/abcdefghijk" }), null, ctx);
    expect(calls[0].url).toContain("https://www.youtube.com/oembed?url=");
    expect(page.items).toEqual([{ sourceReviewId: "video:abcdefghijk", authorName: "Pixel Lane", headline: "Why we switched our studio to Acme", url: "https://www.youtube.com/watch?v=abcdefghijk" }]);
    expect(sanitizeItem(page.items[0], youtube)).toMatchObject({ headline: "Why we switched our studio to Acme", platform: "youtube" });
  });

  it("IMP-01 with YOUTUBE_API_KEY, imports the comments page by page through the Data API", async () => {
    process.env.YOUTUBE_API_KEY = "yt-key";
    const { ctx, calls } = fakeCtx({ "pageToken=PAGE2": { file: "youtube/comments-2.json" }, commentThreads: { file: "youtube/comments-1.json" } });
    const input = youtube.input.parse({ urls: "abcdefghijk" });
    const first = await youtube.fetchPage(input, null, ctx);
    expect(calls[0].url).toMatch(/^https:\/\/www\.googleapis\.com\/youtube\/v3\/commentThreads\?.*videoId=abcdefghijk.*key=yt-key/);
    expect(first.items.map((i) => i.authorName)).toEqual(["morgan.codes", "Priya"]);
    expect(first.items[1].text).toBe("Great walkthrough & tool");
    expect(first.items[1].avatarUrl).toBeUndefined();
    const second = await youtube.fetchPage(input, first.next, ctx);
    expect(second.items.map((i) => i.sourceReviewId)).toEqual(["Ugw4"]);
    expect(second.next).toBeNull();
    await expect(youtube.fetchPage(input, null, fakeCtx({ commentThreads: { status: 400, text: "{}" } }).ctx)).rejects.toBeInstanceOf(ImporterInputError);
  });
});

describe("IMP-01 Reddit importer", () => {
  it("IMP-01 reads the post and its top-level comments, skipping removed ones and bots", async () => {
    const { ctx, calls } = fakeCtx({ "/comments/abc123.json": { file: "reddit/thread.json" } });
    const input = reddit.input.parse({ url: "https://www.reddit.com/r/smallbusiness/comments/abc123/acme_is_the_tool/" });
    const { items } = await reddit.fetchPage(input, null, ctx);
    expect(calls[0].url).toContain("https://www.reddit.com/comments/abc123.json");
    expect(items.map((i) => i.sourceReviewId)).toEqual(["t3_abc123", "t1_c1"]);
    expect(items[0]).toMatchObject({ authorName: "shopkeeper_sam", authorTitle: "u/shopkeeper_sam", headline: "Acme is the tool I wish I'd found sooner" });
    expect(items[1].url).toBe("https://www.reddit.com/r/smallbusiness/comments/abc123/acme_is_the_tool/c1/");
    await expect(reddit.fetchPage(input, null, fakeCtx({ "/comments/": { status: 429, text: "slow down" } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
  });

  it("IMP-01 a saved post page is read from its structured data", () => {
    const items = reddit.parseHtml!(fixture("reddit/saved.html"));
    expect(items.map((i) => [i.sourceReviewId, i.authorName])).toEqual([
      ["t3_abc123", "shopkeeper_sam"],
      ["t1_c1", "dana_k"],
    ]);
  });
});

describe("IMP-01 WooCommerce importer", () => {
  it("IMP-01 reads the Store API 100 at a time and keeps the shop's folder", async () => {
    const { ctx, calls } = fakeCtx({ "page=2": { file: "woocommerce/reviews-2.json" }, "page=1": { file: "woocommerce/reviews-1.json" } });
    const input = woocommerce.input.parse({ url: "shop.example/store/shop/" });
    expect(input).toEqual({ origin: "https://shop.example/store" });
    const first = await woocommerce.fetchPage(input, null, ctx);
    expect(calls[0].url).toBe("https://shop.example/store/wp-json/wc/store/v1/products/reviews?per_page=100&page=1&orderby=date_gmt&order=desc");
    expect(first.items).toHaveLength(100);
    expect(first.items[0]).toMatchObject({ sourceReviewId: "review:1000", authorName: "Ana Costa", rating: 4, text: "Beautiful stitching & fast shipping.", headline: "On Linen apron", avatarUrl: "https://secure.gravatar.example/0.png" });
    expect(first.items[0].date?.value.toISOString()).toBe("2026-09-01T09:00:00.000Z");
    expect(first.next).toBe("2");
    const second = await woocommerce.fetchPage(input, first.next, ctx);
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
  });

  it("IMP-01 falls back to ?rest_route= and says when there's no store", async () => {
    const { ctx, calls } = fakeCtx({ "rest_route=": { file: "woocommerce/reviews-2.json" } });
    const page = await woocommerce.fetchPage(woocommerce.input.parse({ url: "https://plain.example" }), null, ctx);
    expect(calls.map((c) => c.url.includes("rest_route"))).toEqual([false, true]);
    expect(page.items).toHaveLength(1);
    await expect(woocommerce.fetchPage(woocommerce.input.parse({ url: "https://none.example" }), null, fakeCtx({}).ctx)).rejects.toBeInstanceOf(ImporterInputError);
  });
});

describe("IMP-01 Etsy importer", () => {
  it("IMP-01 needs the owner's key, finds the shop by name and reads its reviews", async () => {
    expect(etsy.unavailable!()).toBe("Needs ETSY_API_KEY");
    process.env.ETSY_API_KEY = "etsy-key";
    expect(etsy.unavailable!()).toBeNull();
    const { ctx, calls } = fakeCtx({ "/shops?shop_name=LinenLane": { file: "etsy/shops.json" }, "/shops/31415926/reviews": { file: "etsy/reviews.json" } });
    const page = await etsy.fetchPage(etsy.input.parse({ shop: "https://www.etsy.com/shop/LinenLane?ref=x" }), null, ctx);
    expect(calls.map((c) => c.o.headers?.["x-api-key"])).toEqual(["etsy-key", "etsy-key"]);
    expect(page.items.map((i) => [i.authorName, i.rating, i.text])).toEqual([
      ["Etsy buyer", 5, "Arrived early and beautifully wrapped."],
      ["Etsy buyer", 4, undefined],
    ]);
    expect(page.items[0].url).toBe("https://www.etsy.com/listing/111");
    expect(page.next).toBeNull();
  });
});

describe("IMP-01 WordPress.org importer", () => {
  it("IMP-01 reads the plugin's reviews feed with stars and without the Replies line", async () => {
    const { ctx, calls } = fakeCtx({ "/support/plugin/acme-forms/reviews/feed/": { file: "wordpress/feed.xml" } });
    const page = await wordpress.fetchPage(wordpress.input.parse({ plugin: "https://wordpress.org/plugins/acme-forms/" }), null, ctx);
    expect(calls[0].url).toBe("https://wordpress.org/support/plugin/acme-forms/reviews/feed/");
    expect(page.items.map((i) => [i.authorName, i.rating, i.headline])).toEqual([
      ["gardenwebs", 5, "Does exactly what it says"],
      ["kim_builds", 3, "Good, needs more fields"],
    ]);
    expect(page.items[0].text).toBe("Set up in five minutes & the support forum is quick.");
    expect(page.items[1].text).toBe("Works well.\nWould love a date field.");
    expect(page.next).toBe("2");
  });
});

describe("IMP-01 Apple Podcasts importer", () => {
  it("IMP-01 reads Apple's customer-reviews feed for the show", async () => {
    const { ctx, calls } = fakeCtx({ "customerreviews/page=1/id=1500000000": { file: "applepodcasts/page1.json" } });
    const page = await applepodcasts.fetchPage(applepodcasts.input.parse({ show: "https://podcasts.apple.com/gb/podcast/acme-talks/id1500000000" }), null, ctx);
    expect(calls[0].url).toBe("https://itunes.apple.com/gb/rss/customerreviews/page=1/id=1500000000/sortby=mostrecent/json");
    expect(page.items.map((i) => [i.authorName, i.rating, i.headline])).toEqual([
      ["CommuteListener", 5, "My Monday ritual"],
      ["Rae", 4, "Great show"],
    ]);
    expect(page.items[0].url).toBe("https://podcasts.apple.com/gb/podcast/id1500000000");
    expect(page.next).toBeNull();
  });
});

describe("IMP-01 Feefo importer", () => {
  it("IMP-01 reads service and product reviews from the public API", async () => {
    const { ctx, calls } = fakeCtx({ "/api/20/reviews/all": { file: "feefo/page1.json" } });
    const page = await feefo.fetchPage(feefo.input.parse({ merchant: "https://www.feefo.com/en-GB/reviews/acme-garden" }), null, ctx);
    expect(calls[0].url).toContain("merchant_identifier=acme-garden");
    expect(page.items.map((i) => [i.sourceReviewId, i.authorName, i.rating])).toEqual([
      ["service:svc1", "Helen", 5],
      ["product:prd1", "Helen", 4],
      ["service:svc2", "Tom", 3],
    ]);
    expect(page.items[1]).toMatchObject({ headline: "On Hand trowel", authorTitle: "Bristol" });
    expect(page.next).toBeNull();
  });
});
