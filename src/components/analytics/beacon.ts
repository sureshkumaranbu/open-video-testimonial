/**
 * Sends a cookieless count to /api/collect (WALL-05, FORM-15): a text/plain
 * beacon with the kind and the id, nothing about the person (the server
 * hashes the address with a daily salt; docs/help/analytics.md). Never throws.
 */
export function beacon(body: { t: "wall" | "form"; id: string; k: string; s?: number }) {
  try {
    navigator.sendBeacon?.("/api/collect", JSON.stringify(body));
  } catch {
    /* counting must never get in the way */
  }
}
