import { describe, expect, it } from "vitest";
import { sanitizeItem } from "@/lib/importers/run";
import { airbnb } from "@/lib/importers/sources/airbnb";
import { amazon } from "@/lib/importers/sources/amazon";
import { appsumo } from "@/lib/importers/sources/appsumo";
import { chromewebstore } from "@/lib/importers/sources/chromewebstore";
import { clutch } from "@/lib/importers/sources/clutch";
import { facebook } from "@/lib/importers/sources/facebook";
import { fiverr } from "@/lib/importers/sources/fiverr";
import { linkedin } from "@/lib/importers/sources/linkedin";
import { realtor } from "@/lib/importers/sources/realtor";
import { shopify } from "@/lib/importers/sources/shopify";
import { tripadvisor } from "@/lib/importers/sources/tripadvisor";
import { trustindex } from "@/lib/importers/sources/trustindex";
import { udemy } from "@/lib/importers/sources/udemy";
import { yelp } from "@/lib/importers/sources/yelp";
import { zillow } from "@/lib/importers/sources/zillow";
import { ImporterBlockedError, ImporterInputError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

/** M13's sources that read public page data, and the ones that only take a page saved in the owner's browser. */

const pick = (items: { authorName: string; rating?: number; text?: string }[]) => items.map((i) => [i.authorName, i.rating, i.text]);

describe("IMP-01 Shopify store importer", () => {
  it("IMP-01 reads the review app's structured data on each product page", async () => {
    const { ctx, calls } = fakeCtx({ "/products/linen-apron": { file: "shopify/product.html" } });
    const input = shopify.input.parse({ urls: "https://acme-store.example/products/linen-apron?variant=1\nacme-store.example/products/linen-apron" });
    expect((input as { pages: string[] }).pages).toEqual(["https://acme-store.example/products/linen-apron"]);
    const page = await shopify.fetchPage(input, null, ctx);
    expect(calls[0].url).toBe("https://acme-store.example/products/linen-apron");
    expect(pick(page.items)).toEqual([
      ["Noor A.", 5, "Perfect weight, washes well."],
      ["Ben", 4, "Runs a little long."],
    ]);
    expect(page.items[0]).toMatchObject({ sourceReviewId: "jdgm-501", headline: "Love it", url: "https://acme-store.example/products/linen-apron" });
    expect(shopify.input.safeParse({ urls: "https://acme-store.example/pages/about" }).success).toBe(false);
  });

  it("IMP-01 names the app when it draws reviews only in the browser, so the saved page is offered", async () => {
    const { ctx } = fakeCtx({ "/products/mug": { file: "shopify/js-only.html" } });
    await expect(shopify.fetchPage(shopify.input.parse({ urls: "https://acme-store.example/products/mug" }), null, ctx)).rejects.toThrow(/Yotpo/);
    await expect(shopify.fetchPage(shopify.input.parse({ urls: "https://acme-store.example/products/mug" }), null, ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
    expect(shopify.parseHtml!(fixture("shopify/product.html"))).toHaveLength(2);
  });
});

describe("IMP-01 Clutch, AppSumo and Udemy importers", () => {
  it("IMP-01 Clutch reads the profile's structured data, with a month-only date", async () => {
    const { ctx, calls } = fakeCtx({ "/profile/acme-studio": { file: "clutch/profile.html" } });
    const page = await clutch.fetchPage(clutch.input.parse({ url: "https://clutch.co/profile/acme-studio#reviews" }), null, ctx);
    expect(calls[0].url).toBe("https://clutch.co/profile/acme-studio");
    expect(pick(page.items)).toEqual([
      ["CTO, Fintech startup", 5, "They rebuilt our onboarding and conversion went up."],
      ["Marketing lead", 5, "Clear communication throughout."],
    ]);
    expect(page.items[1].date?.precision).toBe("month");
    await expect(clutch.fetchPage(clutch.input.parse({ url: "acme-studio" }), null, fakeCtx({ "/profile/": { status: 403, text: "no" } }).ctx)).rejects.toBeInstanceOf(ImporterBlockedError);
  });

  it("IMP-01 AppSumo reads microdata reviews; Udemy reads the course's JSON-LD", async () => {
    const a = await appsumo.fetchPage(appsumo.input.parse({ url: "https://appsumo.com/products/acme/" }), null, fakeCtx({ "/products/acme/reviews/": { file: "appsumo/reviews.html" } }).ctx);
    expect(a.items[0]).toMatchObject({ sourceReviewId: "as-77", authorName: "Sumo-ling Rita", rating: 5, headline: "Five tacos", text: "Replaced two other tools for us." });
    const u = await udemy.fetchPage(udemy.input.parse({ url: "https://www.udemy.com/course/acme-for-beginners/" }), null, fakeCtx({ "/course/acme-for-beginners/": { file: "udemy/course.html" } }).ctx);
    expect(pick(u.items)).toEqual([["Kofi B.", 5, "Clear, short lessons."]]);
    expect(u.next).toBeNull();
  });
});

describe("IMP-01 IMP-03 saved-page-only sources never fetch the site", () => {
  it("IMP-03 asking them to fetch says to upload the saved page instead, without a request", async () => {
    for (const a of [yelp, facebook, linkedin, tripadvisor, amazon, fiverr, airbnb, zillow, realtor, chromewebstore, trustindex]) {
      const { ctx, calls } = fakeCtx({});
      await expect(a.fetchPage({}, null, ctx), a.id).rejects.toBeInstanceOf(ImporterInputError);
      expect(calls, a.id).toHaveLength(0);
      expect(a.method).toBe("saved-page");
    }
  });

  it("IMP-01 Yelp and Tripadvisor read the review data in the saved page", () => {
    expect(pick(yelp.parseHtml!(fixture("yelp/saved.html")))).toEqual([
      ["Jess T.", 5, "Best sourdough in town."],
      ["Omar", 4, "Friendly staff, a bit of a queue."],
    ]);
    const ta = tripadvisor.parseHtml!(fixture("tripadvisor/saved.html"));
    expect(ta[0]).toMatchObject({ sourceReviewId: "ta-r-888", authorName: "WanderingFoodie", rating: 5, headline: "Lovely terrace", date: { precision: "month" } });
  });

  it("IMP-01 Amazon reads each data-hook review: stars, title, body and date, in English or German", () => {
    const items = amazon.parseHtml!(fixture("amazon/saved.html"));
    expect(items.map((i) => [i.sourceReviewId, i.authorName, i.rating, i.headline, i.text])).toEqual([
      ["R1EXAMPLE", "Chris W.", 5, "Sturdy and quiet", "Replaced our old fan.\nMuch quieter."],
      ["R2EXAMPLE", "Mo", 3, "OK", "Does the job."],
    ]);
    expect(items[0].url).toBe("https://www.amazon.com/gp/customer-reviews/R1EXAMPLE");
    expect(items[0].date?.value.toISOString().slice(0, 10)).toBe("2026-09-14");
  });

  it("IMP-01 Facebook reads recommendations from the page's embedded data, or a saved post from its preview tags", () => {
    expect(pick(facebook.parseHtml!(fixture("facebook/saved.html")))).toEqual([
      ["Lina Park", undefined, "Ordered a birthday cake and it was perfect."],
      ["Tom Reed", undefined, "Great coffee, friendly team."],
    ]);
    const post = facebook.parseHtml!(fixture("facebook/post.html"));
    expect(post).toEqual([{ sourceReviewId: "https://www.facebook.com/lina.park/posts/123", authorName: "Lina Park", text: "Shout-out to Acme Bakery for the best birthday cake!", url: "https://www.facebook.com/lina.park/posts/123" }]);
  });

  it("IMP-01 LinkedIn reads a saved post's structured data with its comments, or its preview tags", () => {
    const items = linkedin.parseHtml!(fixture("linkedin/post.html"));
    expect(items.map((i) => [i.authorName, i.text])).toEqual([
      ["Ada Lovelace", "We tried Acme for our customer stories and the wall went live in an hour."],
      ["Grace Hopper", "Looks great, which plan are you on?"],
    ]);
    expect(items[0]).toMatchObject({ headline: "Our new testimonial wall", avatarUrl: undefined });
    const og = linkedin.parseHtml!(fixture("linkedin/og-only.html"));
    expect(og[0]).toMatchObject({ authorName: "Ada Lovelace", text: "Acme made collecting video stories painless. Highly recommend." });
  });

  it("IMP-01 Fiverr, Airbnb, Zillow and the Chrome Web Store read review-shaped embedded data; Realtor.com reads microdata", () => {
    expect(pick(fiverr.parseHtml!(fixture("fiverr/saved.html")))).toEqual([
      ["startup_jane", undefined, "Delivered a day early, great logo."],
      ["mike_m", undefined, "Good, one revision needed."],
    ]);
    expect(pick(airbnb.parseHtml!(fixture("airbnb/saved.html")))).toEqual([
      ["Elena", 5, "Spotless flat, great host."],
      ["Sam", 4, "Lovely view, noisy street."],
    ]);
    const z = zillow.parseHtml!(fixture("zillow/saved.html"));
    expect(z.map((i) => [i.sourceReviewId, i.authorName, i.rating])).toEqual([
      ["z-1", "First-time buyers", 5],
      ["z-2", "Seller in Austin", 5],
    ]);
    expect(pick(chromewebstore.parseHtml!(fixture("chromewebstore/saved.html")))).toEqual([
      ["Quinn", 5, "Saves me an hour a day."],
      ["Ari", 3, "Works, but needs dark mode."],
    ]);
    expect(pick(realtor.parseHtml!(fixture("realtor/saved.html")))).toEqual([["Buyer in Denver", 5, "Knew every neighbourhood."]]);
  });

  it("IMP-01 Trustindex reads its widget's items and keeps each review's own site", () => {
    const items = trustindex.parseHtml!(fixture("trustindex/saved.html"));
    expect(items.map((i) => [i.sourceReviewId.startsWith("h_") ? "hash" : i.sourceReviewId, i.authorName, i.rating, i.platform])).toEqual([
      ["ti-9001", "Maya Chen", 5, "google"],
      ["hash", "Paul", 4, "facebook"],
    ]);
    expect(sanitizeItem(items[0], trustindex)!.platform).toBe("google");
    expect(sanitizeItem(items[0], trustindex)!.avatarUrl).toBe("https://lh3.googleusercontent.example/maya.png");
  });
});
