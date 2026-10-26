import { describe, expect, it } from "vitest";
import { appstore, parseFeed } from "@/lib/importers/sources/appstore";
import { ImporterInputError } from "@/lib/importers/types";
import { fakeCtx, fixture } from "./_ctx";

const app = appstore.input.parse({ app: "https://apps.apple.com/gb/app/acme-notes/id123456789" }) as { id: string; country: string };

describe("IMP-01 App Store importer", () => {
  it("IMP-01 reads the app id and country from the link", () => {
    expect(app).toEqual({ id: "123456789", country: "gb" });
    expect(appstore.input.parse({ app: "123456789", country: "DE" })).toEqual({ id: "123456789", country: "de" });
    expect(appstore.input.safeParse({ app: "https://apps.apple.com/us/app/acme" }).success).toBe(false);
  });

  it("IMP-01 pages through the customer-reviews feed with the injected fetch", async () => {
    const { ctx, calls } = fakeCtx({ "page=1/": { file: "appstore/page1.json" }, "page=2/": { file: "appstore/page2.json" } });
    const one = await appstore.fetchPage(app, null, ctx);
    expect(calls[0].url).toBe("https://itunes.apple.com/gb/rss/customerreviews/page=1/id=123456789/sortby=mostrecent/json");
    expect(one.items).toHaveLength(50);
    expect(one.items[0]).toMatchObject({ sourceReviewId: "7100000000", authorName: "Avery Lark", rating: 5, date: { precision: "day" } });
    expect(one.items[0].url).toBe("https://apps.apple.com/gb/app/id123456789?see-all=reviews");
    expect(one.next).toBe("2");
    const two = await appstore.fetchPage(app, one.next, ctx);
    expect(two.items).toHaveLength(10);
    // The feed's "last" link says page 2 is the end.
    expect(two.next).toBeNull();
  });

  it("IMP-01 skips the app entry older feeds start with, and handles a single entry", () => {
    const parsed = parseFeed({ feed: { entry: { id: { label: "1" }, "im:rating": { label: "4" }, author: { name: { label: "Solo" } }, content: { label: "One" } } } }, app);
    expect(parsed.items).toHaveLength(1);
    expect(parseFeed({ feed: { entry: [{ id: { label: "app" }, title: { label: "The app" } }] } }, app).items).toHaveLength(0);
    expect(parseFeed(JSON.parse(fixture("appstore/page1.json")), app).last).toBe(2);
  });

  it("IMP-01 an unknown app is an input problem; a later empty page just ends", async () => {
    await expect(appstore.fetchPage(app, null, fakeCtx({}).ctx)).rejects.toBeInstanceOf(ImporterInputError);
    await expect(appstore.fetchPage(app, "3", fakeCtx({}).ctx)).resolves.toEqual({ items: [], next: null });
  });
});
