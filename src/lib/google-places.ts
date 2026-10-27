import { env } from "./env";

/**
 * BOOST-02's business search: Google's Places API (New) Text Search, called
 * from this server only, with the owner's own GOOGLE_PLACES_API_KEY (the key
 * never reaches the browser). Without a key the editor offers paste only.
 */

export const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export type PlaceHit = { placeId: string; name: string; address: string };

export class PlacesError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const placesSearchAvailable = () => Boolean(env.googlePlacesApiKey);

/** Up to 5 businesses matching `query` ("Acme Bakery, Leeds"). */
export async function searchPlaces(query: string, o: { fetchImpl?: typeof fetch } = {}): Promise<PlaceHit[]> {
  const key = env.googlePlacesApiKey;
  if (!key) throw new PlacesError(409, "Business search needs GOOGLE_PLACES_API_KEY on this server. Paste a Maps link or Place ID instead.");
  const q = query.trim().slice(0, 200);
  if (q.length < 2) throw new PlacesError(400, "Type the business name and town");
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: q, pageSize: 5 }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PlacesError(502, "Google didn't answer. Try again, or paste a Maps link instead.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new PlacesError(502, "Google refused the API key. Check GOOGLE_PLACES_API_KEY and that “Places API (New)” is enabled for it.");
  }
  if (!res.ok) throw new PlacesError(502, `Google answered ${res.status}. Try again, or paste a Maps link instead.`);
  const json = (await res.json().catch(() => null)) as { places?: { id?: unknown; displayName?: { text?: unknown }; formattedAddress?: unknown }[] } | null;
  return (json?.places ?? [])
    .flatMap((p) =>
      typeof p.id === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(p.id)
        ? [{ placeId: p.id, name: String(p.displayName?.text ?? "").slice(0, 200), address: String(p.formattedAddress ?? "").slice(0, 300) }]
        : [],
    )
    .slice(0, 5);
}
