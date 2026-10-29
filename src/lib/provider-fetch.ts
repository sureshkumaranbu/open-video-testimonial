/**
 * Calls to the owner's own AI or translation provider (INBOX-13, INBOX-14),
 * and to Stripe for thank-you coupons (INT-07), from the server only. The
 * address comes from the server's settings, never from a request, so like
 * transcription (TRANSCRIBE_API_URL) it may be a self-hosted service on the
 * owner's own network. Answers are read with a size cap and a timeout, and a
 * failure is an error the caller handles.
 */

export class ProviderError extends Error {
  /** The HTTP status the provider answered with, when it answered. */
  status?: number;
  /** The answer's parsed JSON, when it answered with an error in JSON. */
  body?: unknown;
}

type RequestOptions = { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number };

/** A request with a ready-made body (JSON or form-encoded); the answer must be JSON. */
export async function providerRequest(url: string, o: RequestOptions & { method?: string; body?: string; contentType?: string } = {}): Promise<unknown> {
  const maxBytes = o.maxBytes ?? 8 * 1024 * 1024;
  let res: Response;
  try {
    res = await fetch(url, {
      method: o.method ?? "POST",
      headers: { ...(o.body !== undefined ? { "Content-Type": o.contentType ?? "application/json" } : {}), Accept: "application/json", ...o.headers },
      body: o.body,
      redirect: "error",
      signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
    });
  } catch (err) {
    throw new ProviderError(`couldn't reach ${new URL(url).host} (${(err as Error).message})`);
  }
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ProviderError(`${new URL(url).host}'s answer was too large`);
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!res.ok) {
    const err = new ProviderError(`${new URL(url).host} answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    err.status = res.status;
    try {
      err.body = JSON.parse(text);
    } catch {
      // Not JSON: the message has the start of it.
    }
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(`${new URL(url).host}'s answer wasn't JSON`);
  }
}

export async function providerJson(url: string, body: unknown, o: RequestOptions = {}): Promise<unknown> {
  return providerRequest(url, { ...o, method: "POST", body: JSON.stringify(body), contentType: "application/json" });
}
