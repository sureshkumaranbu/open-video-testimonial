/**
 * The one fetch helper for dashboard components (same-origin, so the browser
 * sends the Origin and Sec-Fetch-Site headers the CSRF check needs). Errors
 * carry the server's own message and the HTTP status.
 *
 * Published by WP1.1 as the shared contract; WP1.7 owns it. New components
 * import it; older copies inside existing components are replaced when a
 * package takes over that file.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // A FormData body sets its own multipart Content-Type.
  const json = init?.body !== undefined && !(init.body instanceof FormData);
  const res = await fetch(url, {
    ...init,
    headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error || `Request failed (${res.status})`);
  return body as T;
}
