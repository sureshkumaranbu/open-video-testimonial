/**
 * The one fetch helper for dashboard components (same-origin, so the browser
 * sends the Origin and Sec-Fetch-Site headers the CSRF check needs). Errors
 * carry the server's own message and the HTTP status.
 *
 * New components import it; older copies inside existing components are
 * replaced when a package takes over that file (plan §3.4).
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The parsed response body, for routes that explain a refusal (409 details, skipped ids). */
    public data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** `json` is sent as a JSON body (with its Content-Type); `body` is sent as it is. */
export type ApiInit = RequestInit & { json?: unknown };

/** Shown when the server sends no message of its own. Each says what to do next. */
function fallbackMessage(status: number) {
  if (status === 401) return "You're signed out. Sign in again to carry on.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "That no longer exists. Reload the page.";
  if (status === 413) return "That's too large to send.";
  if (status === 429) return "Too many requests. Wait a minute, then try again.";
  if (status >= 500) return "Something went wrong on the server. Try again in a moment.";
  return `Request failed (${status}). Try again.`;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

export async function api<T>(url: string, init?: ApiInit): Promise<T> {
  const { json, ...rest } = init ?? {};
  const body = json !== undefined ? JSON.stringify(json) : rest.body;
  const headers = new Headers(rest.headers);
  // A FormData, Blob or URLSearchParams body sets its own Content-Type.
  if (typeof body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(url, { ...rest, body, headers });
  } catch (e) {
    // A cancelled request is the caller's business, not an error to show.
    if (isAbort(e)) throw e;
    throw new ApiError(0, "Can't reach Plaudit. Check your connection, then try again.");
  }

  const text = await res.text().catch(() => "");
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    const error = (data as { error?: unknown } | null)?.error;
    throw new ApiError(res.status, typeof error === "string" && error ? error : fallbackMessage(res.status), data);
  }
  return data as T;
}

/** True for an ApiError, optionally with one of the given statuses. */
export function isApiError(e: unknown, ...statuses: number[]): e is ApiError {
  return e instanceof ApiError && (statuses.length === 0 || statuses.includes(e.status));
}

/** A message to show for anything a handler caught. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Try again.") {
  return e instanceof Error && e.message ? e.message : fallback;
}
