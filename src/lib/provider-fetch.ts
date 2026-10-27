/**
 * Calls to the owner's own AI or translation provider (INBOX-13, INBOX-14),
 * from the server only. The address comes from the server's settings, never
 * from a request, so like transcription (TRANSCRIBE_API_URL) it may be a
 * self-hosted service on the owner's own network. Answers are read with a
 * size cap and a timeout, and a failure is an error the caller handles.
 */

export class ProviderError extends Error {}

export async function providerJson(url: string, body: unknown, o: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {}): Promise<unknown> {
  const maxBytes = o.maxBytes ?? 8 * 1024 * 1024;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...o.headers },
      body: JSON.stringify(body),
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
  if (!res.ok) throw new ProviderError(`${new URL(url).host} answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(`${new URL(url).host}'s answer wasn't JSON`);
  }
}
