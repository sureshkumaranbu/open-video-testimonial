import { z } from "zod";
import { env } from "../../env";
import { cleanLine, cleanText, httpUrl, parseJson, parseSourceDate, pick, toRating } from "../html";
import { ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";

/**
 * Google reviews through the Places API (New) with the owner's own key
 * (GOOGLE_PLACES_API_KEY): Place Details for a place ID, or Text Search for
 * a business name. Google returns at most 5 reviews per place, so one page
 * is all there is.
 */

const PLACE_ID = /^[A-Za-z0-9_-]{16,300}$/;

const input = z
  .object({ place: z.string().trim().min(2, "Type your business name and town, or paste its place ID").max(500) })
  .transform((v) => {
    const fromUrl = /(?:query_place_id|place_id)[=:]([A-Za-z0-9_-]{16,300})/.exec(v.place)?.[1];
    if (fromUrl) return { placeId: fromUrl, query: null };
    if (PLACE_ID.test(v.place) && !/\s/.test(v.place)) return { placeId: v.place, query: null };
    return { placeId: null, query: v.place };
  });
type Input = z.output<typeof input>;

type Obj = Record<string, unknown>;

export function parsePlace(place: Obj): ImportedReview[] {
  const reviews = Array.isArray(place.reviews) ? (place.reviews as Obj[]) : [];
  const items: ImportedReview[] = [];
  for (const r of reviews) {
    const id = pick(r, "name");
    if (typeof id !== "string") continue;
    // The author's own words, not Google's translation of them.
    const original = pick(r, "originalText.text");
    items.push({
      sourceReviewId: id,
      authorName: cleanLine(pick(r, "authorAttribution.displayName")) ?? "Google user",
      avatarUrl: httpUrl(pick(r, "authorAttribution.photoUri")),
      rating: toRating(pick(r, "rating")),
      text: cleanText(original ?? pick(r, "text.text")),
      language: String(pick(r, original ? "originalText.languageCode" : "text.languageCode") ?? "") || undefined,
      date: parseSourceDate(pick(r, "publishTime")),
      url: httpUrl(pick(r, "googleMapsUri")) ?? httpUrl(place.googleMapsUri),
    });
  }
  return items;
}

async function call(ctx: Parameters<ImporterAdapter["fetchPage"]>[2], url: string, mask: string, body?: object) {
  const res = await ctx.fetchText(url, {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "X-Goog-Api-Key": env.googlePlacesApiKey, "X-Goog-FieldMask": mask, accept: "application/json" },
    timeoutMs: 10_000,
    maxBytes: 2 * 1024 * 1024,
  });
  const json = parseJson(res.text) as Obj | undefined;
  if (res.status === 400 || res.status === 404) throw new ImporterInputError("Google doesn't know that place. Check the place ID, or search by name and town.");
  if (res.status === 401 || res.status === 403) {
    throw new ImporterInputError("Google refused the API key. Check GOOGLE_PLACES_API_KEY and that “Places API (New)” is enabled for it.");
  }
  if (res.status !== 200 || !json) throw new Error(`Google answered ${res.status}`);
  return json;
}

export const google: ImporterAdapter = {
  id: "google",
  label: "Google",
  platform: "google",
  kind: "platform",
  method: "official-api",
  tosNotes: "Uses Google’s Places API with your own key. Google shares at most 5 reviews per place (its most relevant ones), so import often or add others by hand. Import only your own business.",
  fields: [
    { key: "place", label: "Business name and town, or place ID", placeholder: "Acme Bakery, Leeds", hint: "Find a place ID with Google’s Place ID Finder." },
  ],
  input,
  unavailable: () => (env.googlePlacesApiKey ? null : "Needs GOOGLE_PLACES_API_KEY"),
  async fetchPage(raw, _cursor, ctx) {
    const i = raw as Input;
    const origin = ctx.origin("https://places.googleapis.com");
    let place: Obj | undefined;
    if (i.placeId) {
      place = await call(ctx, `${origin}/v1/places/${encodeURIComponent(i.placeId)}`, "id,displayName,googleMapsUri,reviews");
    } else {
      const found = await call(ctx, `${origin}/v1/places:searchText`, "places.id,places.displayName,places.googleMapsUri,places.reviews", { textQuery: i.query, pageSize: 1 });
      place = Array.isArray(found.places) ? (found.places[0] as Obj | undefined) : undefined;
      if (!place) throw new ImporterInputError("Google found no place by that name. Add the town, or paste the place ID.");
    }
    return { items: parsePlace(place), next: null };
  },
};
