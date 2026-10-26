import { afterEach, describe, expect, it } from "vitest";
import { google } from "@/lib/importers/sources/google";
import { ImporterInputError } from "@/lib/importers/types";
import { fakeCtx } from "./_ctx";

afterEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
});

describe("IMP-01 Google importer", () => {
  it("IMP-01 needs your own GOOGLE_PLACES_API_KEY", () => {
    expect(google.unavailable!()).toMatch(/GOOGLE_PLACES_API_KEY/);
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    expect(google.unavailable!()).toBeNull();
  });

  it("IMP-01 tells a place ID from a search", () => {
    expect(google.input.parse({ place: "ChIJsyntheticPlace000001" })).toEqual({ placeId: "ChIJsyntheticPlace000001", query: null });
    expect(google.input.parse({ place: "https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJsyntheticPlace000001" })).toMatchObject({ placeId: "ChIJsyntheticPlace000001" });
    expect(google.input.parse({ place: "Acme Bakery, Leeds" })).toEqual({ placeId: null, query: "Acme Bakery, Leeds" });
  });

  it("IMP-01 reads up to 5 reviews from Place Details with the key in a header", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    const { ctx, calls } = fakeCtx({ "/v1/places/": { file: "google/place.json", contentType: "application/json" } });
    const page = await google.fetchPage({ placeId: "ChIJsyntheticPlace000001", query: null }, null, ctx);
    expect(calls[0].url).toBe("https://places.googleapis.com/v1/places/ChIJsyntheticPlace000001");
    expect(calls[0].o.headers).toMatchObject({ "X-Goog-Api-Key": "test-key", "X-Goog-FieldMask": expect.stringContaining("reviews") });
    // Never in the URL, where logs would keep it.
    expect(calls[0].url).not.toContain("test-key");
    expect(page.next).toBeNull();
    expect(page.items).toHaveLength(5);
    expect(page.items[0]).toMatchObject({ authorName: "Nadia Park", rating: 5, text: "Best sourdough in town.", language: "en", avatarUrl: "https://lh3.googleusercontent.example/a/nadia" });
    // The author's own words, not Google's translation.
    expect(page.items[1]).toMatchObject({ text: "Super Kaffee, die Schlange geht schnell.", language: "de" });
    expect(page.items[2].text).toBeUndefined();
  });

  it("IMP-01 searches by name with Text Search, and reports a refused key", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    const { ctx, calls } = fakeCtx({ "places:searchText": { file: "google/search.json" } });
    const page = await google.fetchPage({ placeId: null, query: "Acme Bakery, Leeds" }, null, ctx);
    expect(calls[0].o.method).toBe("POST");
    expect(JSON.parse(calls[0].o.body!)).toEqual({ textQuery: "Acme Bakery, Leeds", pageSize: 1 });
    expect(page.items).toHaveLength(5);
    await expect(google.fetchPage({ placeId: "x".repeat(20), query: null }, null, fakeCtx({ "/v1/": { status: 403, text: "{}" } }).ctx)).rejects.toBeInstanceOf(ImporterInputError);
  });
});
