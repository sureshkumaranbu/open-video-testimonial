/**
 * Browser side of the resumable upload protocol (see src/app/api/uploads).
 * Bytes can be appended while they are still being produced, e.g. by
 * MediaRecorder, so most of a recording is already on the server by the time
 * the person presses stop. Failed requests are retried, and the upload
 * resumes from whatever offset the server confirms.
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
  readonly opts: Required<Omit<ResumableUploadOptions, "onProgress" | "fetch">> & {
    onProgress?: ResumableUploadOptions["onProgress"];
    fetch: FetchLike;
  };
  private parts: Blob[] = [];
  private total = 0;
  private acked = 0;
  private closed = false;
  private aborted = false;
  private session: Promise<{ id: string; token: string }> | null = null;
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
    };
  }

  get state(): UploadState {
    return {
      sent: this.acked,
      total: this.total,
      done: this.closed && this.acked === this.total,
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
    if (this.acked !== this.total) {
      this.kick();
      while (this.pumping) await this.pumping;
      if (this.acked !== this.total) throw new UploadFailed(this.error ?? "Upload incomplete");
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
      const res = await this.opts.fetch(this.opts.createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: this.closed ? this.total : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429 || res.status >= 500) throw new Error(body.error || `Upload couldn't start (${res.status})`);
      if (!res.ok) throw new UploadFailed(body.error || `Upload couldn't start (${res.status})`, isFileRejection(res.status));
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
      if (!this.error && !this.aborted && this.acked < this.total && this.ready()) this.kick();
    });
  }

  private ready() {
    return this.closed || this.total - this.acked >= this.opts.minChunk;
  }

  private emit() {
    this.opts.onProgress?.(this.state);
  }

  private async pump() {
    let failures = 0;
    while (!this.aborted && this.acked < this.total && this.ready()) {
      try {
        const { id, token } = await this.start();
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
        if (res.status === 404) {
          // The session expired: start over with a new one.
          this.session = null;
          this.acked = 0;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 404 && res.status !== 429) {
          throw new UploadFailed(body.error || `Upload rejected (${res.status})`, isFileRejection(res.status));
        }
        throw new Error(body.error || `Upload failed (${res.status})`);
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
    if (!this.session) return;
    try {
      const { id, token } = await this.session;
      const res = await this.opts.fetch(this.opts.chunkUrl + id, { headers: { "X-Upload-Token": token } });
      if (res.ok) this.acked = Number((await res.json()).offset);
      else if (res.status === 404) {
        this.session = null;
        this.acked = 0;
      }
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
