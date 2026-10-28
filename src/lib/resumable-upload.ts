/**
 * Browser side of the resumable upload protocol (see src/app/api/uploads).
 * Bytes can be appended while they are still being produced, e.g. by
 * MediaRecorder, so most of a recording is already on the server by the time
 * the person presses stop. Failed requests are retried, and the upload
 * resumes from whatever offset the server confirms.
 *
 * When the server offers it (S3_DIRECT_UPLOADS, L9), the bytes go straight
 * to the bucket instead, one part at a time through URLs the server
 * presigns, and the server checks the file once every part is there. If the
 * bucket can't be reached (its CORS isn't set up, say), the same session
 * carries on through the server from the first byte.
 */
export type UploadState = {
  sent: number;
  total: number;
  done: boolean;
  error: string | null;
  /** The server refused the file itself (too large, not a video): retrying can't help. */
  fatal: boolean;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ResumableUploadOptions {
  /** POST endpoint that creates the session, e.g. /api/projects/acme/uploads. */
  createUrl: string;
  /** Prefix for chunk requests; the session id is appended. */
  chunkUrl?: string;
  /** Bytes per request. Smaller pieces are batched up to this size. */
  chunkSize?: number;
  /** Wait for this many bytes before sending a chunk while more is coming. */
  minChunk?: number;
  /** The total size when it's known before sending (a picked file), so the server can refuse it at once. */
  size?: number;
  /** Ask for a direct-to-storage upload (L9); the server decides. On unless false. */
  direct?: boolean;
  retries?: number;
  retryDelayMs?: number;
  fetch?: FetchLike;
  onProgress?: (state: UploadState) => void;
}

export class UploadFailed extends Error {
  constructor(
    message: string,
    readonly fatal = false,
  ) {
    super(message);
  }
}

/** 413 (too large) and 415 (not a video) are about the file, not the connection. */
const isFileRejection = (status: number) => status === 413 || status === 415;

export class ResumableUpload {
  readonly opts: Required<Omit<ResumableUploadOptions, "onProgress" | "fetch" | "size" | "direct">> & {
    direct: boolean;
    onProgress?: ResumableUploadOptions["onProgress"];
    size?: number;
    fetch: FetchLike;
  };
  private parts: Blob[] = [];
  private total = 0;
  private acked = 0;
  private closed = false;
  private aborted = false;
  private session: Promise<{ id: string; token: string }> | null = null;
  /** The bucket's part size while this session uploads directly (L9); null when relayed. */
  private partSize: number | null = null;
  /** Direct parts are all in and the server has checked the file. */
  private completed = false;
  private pumping: Promise<void> | null = null;
  private error: string | null = null;
  private fatal = false;

  constructor(opts: ResumableUploadOptions) {
    this.opts = {
      chunkUrl: "/api/uploads/",
      chunkSize: 4 * 1024 * 1024,
      minChunk: 256 * 1024,
      retries: 6,
      retryDelayMs: 500,
      fetch: (input, init) => fetch(input, init),
      ...opts,
      direct: opts.direct !== false,
    };
  }

  get state(): UploadState {
    return {
      sent: this.acked,
      total: this.total,
      done: this.closed && !this.pending(),
      error: this.error,
      fatal: this.fatal,
    };
  }

  /** Adds bytes to the end of the upload and starts sending them. */
  append(blob: Blob) {
    if (this.closed || this.aborted) throw new Error("Upload already finished");
    if (blob.size === 0) return;
    this.parts.push(blob);
    this.total += blob.size;
    this.kick();
  }

  /** Marks the end of the data and resolves once every byte is on the server. */
  async finish(): Promise<{ id: string; token: string }> {
    this.closed = true;
    this.kick();
    while (this.pumping) await this.pumping;
    if (this.error) throw new UploadFailed(this.error, this.fatal);
    if (this.pending()) {
      this.kick();
      while (this.pumping) await this.pumping;
      if (this.pending()) throw new UploadFailed(this.error ?? "Upload incomplete");
    }
    return this.start();
  }

  /** Retries after a failure, continuing from the server's offset. */
  retry() {
    if (this.fatal) return;
    this.error = null;
    this.kick();
  }

  /** Stops uploading and asks the server to throw the bytes away. */
  async abort() {
    this.aborted = true;
    if (!this.session) return;
    try {
      const { id, token } = await this.session;
      await this.opts.fetch(this.opts.chunkUrl + id, { method: "DELETE", headers: { "X-Upload-Token": token } });
    } catch {
      // Best effort: the server also expires abandoned uploads.
    }
  }

  private start() {
    this.session ??= (async () => {
      const size = this.opts.size ?? (this.closed ? this.total : undefined);
      // The type the bucket's parts are pinned to; the server sniffs the real one.
      const direct = this.opts.direct ? { direct: true, contentType: this.parts[0]?.type || undefined } : {};
      const res = await this.opts.fetch(this.opts.createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size, ...direct }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429 || res.status >= 500) throw new Error(body.error || `Upload couldn't start (${res.status})`);
      if (!res.ok) throw new UploadFailed(body.error || `Upload couldn't start (${res.status})`, isFileRejection(res.status));
      const partSize = Number(body.direct?.partSize);
      this.partSize = Number.isSafeInteger(partSize) && partSize > 0 ? partSize : null;
      this.completed = false;
      return { id: body.id as string, token: body.token as string };
    })();
    this.session.catch(() => {
      this.session = null; // let a retry create a fresh session
    });
    return this.session;
  }

  private kick() {
    if (this.pumping || this.aborted || this.error) return;
    this.pumping = this.pump().finally(() => {
      this.pumping = null;
      // More data may have arrived while the last request was in flight.
      if (!this.error && !this.aborted && this.pending() && this.ready()) this.kick();
    });
  }

  /** Bytes still to send, or a direct upload the server hasn't checked yet. */
  private pending() {
    return this.acked < this.total || (this.partSize !== null && this.closed && this.total > 0 && !this.completed);
  }

  private ready() {
    // A direct part (all but the last) must be exactly partSize.
    return this.closed || this.total - this.acked >= (this.partSize ?? this.opts.minChunk);
  }

  /** Starts over with a new session (the old one expired). */
  private restart() {
    this.session = null;
    this.partSize = null;
    this.acked = 0;
  }

  /** Turns a refused request into the error pump() handles: fatal for the file itself, retried otherwise. */
  private refused(res: Response, body: { error?: string }): never {
    if (res.status === 404) this.restart();
    if (res.status >= 400 && res.status < 500 && res.status !== 404 && res.status !== 429) {
      throw new UploadFailed(body.error || `Upload rejected (${res.status})`, isFileRejection(res.status));
    }
    throw new Error(body.error || `Upload failed (${res.status})`);
  }

  /**
   * One step of a direct upload (L9): the next part, presigned by the server
   * and PUT to the bucket, or, once they're all there, the server's check.
   * A PUT the bucket doesn't take falls back to the relayed path.
   */
  private async directStep(id: string, token: string, partSize: number) {
    const base = this.opts.chunkUrl + id;
    if (this.acked >= this.total) {
      const res = await this.opts.fetch(`${base}/complete`, { method: "POST", headers: { "X-Upload-Token": token } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) this.refused(res, body);
      this.completed = true;
      return;
    }
    const end = Math.min(this.acked + partSize, this.total);
    const part = new Blob(this.parts).slice(this.acked, end);
    const res = await this.opts.fetch(`${base}/parts`, {
      method: "POST",
      headers: { "X-Upload-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ partNumber: Math.floor(this.acked / partSize) + 1, size: part.size }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) this.refused(res, body);
    let put: Response | null = null;
    try {
      put = await this.opts.fetch(body.url, { method: "PUT", headers: body.headers, body: part });
      await put.body?.cancel().catch(() => undefined);
    } catch {
      put = null; // a CORS refusal looks like a network error
    }
    if (!put?.ok) {
      // The server takes the same session from byte 0 and drops the bucket's parts.
      this.partSize = null;
      this.acked = 0;
      return;
    }
    this.acked = end;
  }

  private emit() {
    this.opts.onProgress?.(this.state);
  }

  private async pump() {
    let failures = 0;
    while (!this.aborted && this.pending() && this.ready()) {
      try {
        const { id, token } = await this.start();
        if (this.partSize !== null) {
          // The session may only now have said it's direct: a part must be whole, so wait for more.
          if (!this.ready()) break;
          await this.directStep(id, token, this.partSize);
          failures = 0;
          this.emit();
          continue;
        }
        const end = Math.min(this.acked + this.opts.chunkSize, this.total);
        const chunk = new Blob(this.parts).slice(this.acked, end);
        const res = await this.opts.fetch(`${this.opts.chunkUrl}${id}?offset=${this.acked}`, {
          method: "PUT",
          headers: { "X-Upload-Token": token, "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok || res.status === 409) {
          // On 409 the server tells us where it actually is (a previous
          // response was lost); carry on from there.
          this.acked = Number(body.offset);
          failures = 0;
          this.emit();
          continue;
        }
        // A 404 means the session expired: start over with a new one.
        this.refused(res, body);
      } catch (err) {
        failures++;
        if (err instanceof UploadFailed || failures > this.opts.retries) {
          this.error =
            err instanceof UploadFailed ? err.message : "The upload keeps failing. Check your connection and try again.";
          this.fatal = err instanceof UploadFailed && err.fatal;
          this.emit();
          return;
        }
        await new Promise((r) => setTimeout(r, this.opts.retryDelayMs * 2 ** (failures - 1)));
        await this.resync();
      }
    }
    this.emit();
  }

  /** Asks the server how many bytes it really has. */
  private async resync() {
    // A direct session's offset stays 0 until it's checked; its parts are retried as they are.
    if (!this.session || this.partSize !== null) return;
    try {
      const { id, token } = await this.session;
      const res = await this.opts.fetch(this.opts.chunkUrl + id, { headers: { "X-Upload-Token": token } });
      if (res.ok) this.acked = Number((await res.json()).offset);
      else if (res.status === 404) this.restart();
    } catch {
      // Still offline; the next attempt will try again.
    }
  }
}

// ------------------------------------------------------------ recording

const WEBM = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const MP4 = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4"];

/** Safari (and every iOS browser, which all use WebKit) records MP4 most reliably. */
export function prefersMp4(userAgent: string) {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent));
  const safari = /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Android/.test(userAgent);
  return ios || safari;
}

/** Picks the first container/codec the browser can record, or undefined for its default. */
export function pickMimeType(isTypeSupported: (type: string) => boolean, userAgent: string) {
  const order = prefersMp4(userAgent) ? [...MP4, ...WEBM] : [...WEBM, ...MP4];
  return order.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

export function extensionFor(mime: string) {
  return mime.includes("mp4") ? "mp4" : mime.includes("quicktime") ? "mov" : "webm";
}
