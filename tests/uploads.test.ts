import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as startUpload } from "@/app/api/projects/[slug]/uploads/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { DELETE, GET, PUT } from "@/app/api/uploads/[id]/route";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { pickMimeType, prefersMp4, ResumableUpload } from "@/lib/resumable-upload";
import { createProject, getTestimonial, updateProject } from "@/lib/testimonials";
import { resetRateLimits } from "@/lib/rate-limit";
import { cleanupExpiredUploads, MAX_OPEN_UPLOADS_PER_PROJECT } from "@/lib/uploads";
import { params, PNG_BYTES, submissionForm, submitRequest, useTempDataDir, WEBM_BYTES } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const IP = { "x-forwarded-for": "198.51.100.20" };

async function start(slug = "acme", body: unknown = {}) {
  return startUpload(
    new Request(`http://localhost/api/projects/${slug}/uploads`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { ...IP, "content-type": "application/json" },
    }),
    params({ slug }),
  );
}

function chunk(id: string, token: string, offset: number, bytes: Uint8Array) {
  return PUT(
    new Request(`http://localhost/api/uploads/${id}?offset=${offset}`, {
      method: "PUT",
      body: new Blob([new Uint8Array(bytes)]),
      headers: { ...IP, "x-upload-token": token },
    }),
    params({ id }),
  );
}

function status(id: string, token: string) {
  return GET(new Request(`http://localhost/api/uploads/${id}`, { headers: { "x-upload-token": token } }), params({ id }));
}

/** Routes fetch() calls from the browser uploader to the real handlers. */
function routeFetch(hook?: (url: URL, init: RequestInit) => void) {
  return async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "http://localhost");
    hook?.(url, init);
    const req = new Request(url, { ...init, headers: { ...IP, ...(init.headers as Record<string, string>) } });
    const create = /^\/api\/projects\/([^/]+)\/uploads$/.exec(url.pathname);
    if (create) return startUpload(req, params({ slug: create[1] }));
    const id = url.pathname.split("/").pop()!;
    const handler = { GET, PUT, DELETE }[req.method as "GET" | "PUT" | "DELETE"];
    return handler(req, params({ id }));
  };
}

describe("resumable upload API", () => {
  it("appends chunks in order and reports the offset", async () => {
    const res = await start();
    expect(res.status).toBe(201);
    const { id, token, offset } = await res.json();
    expect(offset).toBe(0);

    const first = await chunk(id, token, 0, WEBM_BYTES.subarray(0, 6));
    expect(await first.json()).toEqual({ offset: 6 });
    const second = await chunk(id, token, 6, WEBM_BYTES.subarray(6));
    expect(await second.json()).toEqual({ offset: WEBM_BYTES.length });
    expect(await (await status(id, token)).json()).toEqual({ offset: WEBM_BYTES.length });
    expect(new Uint8Array(fs.readFileSync(path.join(env.tmpDir, `${id}.part`)))).toEqual(WEBM_BYTES);
  });

  it("rejects a stale offset with the server's real offset (409)", async () => {
    const { id, token } = await (await start()).json();
    await chunk(id, token, 0, WEBM_BYTES.subarray(0, 8));
    const replay = await chunk(id, token, 0, WEBM_BYTES.subarray(0, 8));
    expect(replay.status).toBe(409);
    expect((await replay.json()).offset).toBe(8);
  });

  it("stops reading a body without Content-Length once it passes the chunk limit", async () => {
    const { id, token } = await (await start()).json();
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1024 * 1024;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (sent > 64 * 1024 * 1024) controller.close();
      },
    });
    const res = await PUT(
      new Request(`http://localhost/api/uploads/${id}?offset=0`, {
        method: "PUT",
        body: endless,
        headers: { ...IP, "x-upload-token": token },
        duplex: "half",
      } as RequestInit),
      params({ id }),
    );
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(16 * 1024 * 1024); // gave up early instead of buffering it all
    expect((await (await status(id, token)).json()).offset).toBe(0);
  });

  it("caps how many unfinished uploads a project can have", async () => {
    for (let i = 0; i < MAX_OPEN_UPLOADS_PER_PROJECT; i++) {
      resetRateLimits();
      expect((await start()).status).toBe(201);
    }
    resetRateLimits();
    expect((await start()).status).toBe(429);
  });

  it("refuses requests without the right token", async () => {
    const { id } = await (await start()).json();
    expect((await chunk(id, "wrong-token", 0, WEBM_BYTES)).status).toBe(404);
    expect((await status(id, "")).status).toBe(404);
  });

  it("enforces the size limit and drops the upload", async () => {
    process.env.MAX_VIDEO_MB = String(10 / (1024 * 1024)); // 10 bytes
    try {
      const { id, token } = await (await start()).json();
      const res = await chunk(id, token, 0, WEBM_BYTES);
      expect(res.status).toBe(413);
      expect((await status(id, token)).status).toBe(404);
      expect((await start("acme", { size: 11 })).status).toBe(413);
    } finally {
      delete process.env.MAX_VIDEO_MB;
    }
  });

  it("refuses a file that isn't a video on its first chunk (415) and drops the upload", async () => {
    const { id, token } = await (await start()).json();
    const text = new TextEncoder().encode("This is a text file named holiday.mp4, not a video at all.");
    const res = await chunk(id, token, 0, text);
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("This file isn't a video we can use. Choose a WebM, MP4, MOV or Ogg video.");
    expect((await status(id, token)).status).toBe(404);
    // A real video header is accepted.
    const ok = await (await start()).json();
    expect((await chunk(ok.id, ok.token, 0, WEBM_BYTES)).status).toBe(200);
  });

  it("the browser uploader marks size and type refusals as fatal, so it won't retry them", async () => {
    const states: { error: string | null; fatal: boolean }[] = [];
    const upload = new ResumableUpload({ createUrl: "/api/projects/acme/uploads", fetch: routeFetch(), onProgress: (s) => states.push(s) });
    upload.append(new Blob([new TextEncoder().encode("plain text, definitely not a video file")]));
    await expect(upload.finish()).rejects.toMatchObject({ fatal: true });
    expect(states.at(-1)).toMatchObject({ fatal: true, error: expect.stringMatching(/isn't a video/) });
  });

  it("refuses uploads for unknown projects or projects without video", async () => {
    expect((await start("nope")).status).toBe(404);
    updateProject(projectId, { allowVideo: false });
    expect((await start()).status).toBe(400);
  });

  it("abandons an upload on DELETE", async () => {
    const { id, token } = await (await start()).json();
    const res = await DELETE(
      new Request(`http://localhost/api/uploads/${id}`, { method: "DELETE", headers: { "x-upload-token": token } }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(env.tmpDir, `${id}.part`))).toBe(false);
  });

  it("cleans up expired sessions", async () => {
    const { id } = await (await start()).json();
    expect(await cleanupExpiredUploads(new Date(Date.now() + 25 * 60 * 60 * 1000))).toBe(1);
    expect(getDb().select().from(schema.uploads).all()).toHaveLength(0);
    expect(fs.existsSync(path.join(env.tmpDir, `${id}.part`))).toBe(false);
  });
});

describe("submitting with a finished upload", () => {
  async function uploaded(bytes: Uint8Array) {
    const { id, token } = await (await start()).json();
    await chunk(id, token, 0, bytes);
    return { id, token };
  }

  it("attaches the uploaded video and consumes the session", async () => {
    const { id, token } = await uploaded(WEBM_BYTES);
    const res = await submit(
      submitRequest("acme", submissionForm({ name: "Ada", consent: "on", videoUpload: id, videoUploadToken: token })),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(201);
    const saved = getTestimonial((await res.json()).id)!;
    expect(saved.videoKey).toMatch(/^videos\/.+\.webm$/);
    expect(saved.videoOriginalKey).toBe(saved.videoKey);
    expect(saved.videoMime).toBe("video/webm");
    expect(fs.existsSync(path.join(env.uploadsDir, saved.videoKey!))).toBe(true);
    expect(getDb().select().from(schema.uploads).all()).toHaveLength(0);

    // The same upload can't be attached twice.
    const again = await submit(
      submitRequest("acme", submissionForm({ name: "Ada", consent: "on", videoUpload: id, videoUploadToken: token })),
      params({ slug: "acme" }),
    );
    expect(again.status).toBe(400);
  });

  it("rejects an upload that isn't a video, while uploading and again at submission", async () => {
    // Caught on the first chunk: the upload is gone before anyone presses Submit.
    const early = await (await start()).json();
    expect((await chunk(early.id, early.token, 0, PNG_BYTES)).status).toBe(415);
    // Too short to judge while uploading, so the final check at submission catches it.
    const { id, token } = await uploaded(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const res = await submit(
      submitRequest("acme", submissionForm({ name: "Ada", consent: "on", videoUpload: id, videoUploadToken: token })),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This file isn't a video we can use. Choose a WebM, MP4, MOV or Ogg video.");
  });

  it("rejects another project's upload", async () => {
    createProject({ name: "Other", slug: "other" });
    const { id, token } = await (await start("other")).json();
    await chunk(id, token, 0, WEBM_BYTES);
    const res = await submit(
      submitRequest("acme", submissionForm({ name: "Ada", consent: "on", videoUpload: id, videoUploadToken: token })),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("ResumableUpload (browser uploader)", () => {
  it("streams appended pieces and finishes with every byte on the server", async () => {
    const puts: number[] = [];
    const upload = new ResumableUpload({
      createUrl: "/api/projects/acme/uploads",
      chunkSize: 5,
      minChunk: 4,
      fetch: routeFetch((url, init) => init.method === "PUT" && puts.push(Number(url.searchParams.get("offset")))),
    });
    upload.append(new Blob([WEBM_BYTES.subarray(0, 3)]));
    upload.append(new Blob([WEBM_BYTES.subarray(3, 10)]));
    upload.append(new Blob([WEBM_BYTES.subarray(10)]));
    const { id } = await upload.finish();
    expect(upload.state).toMatchObject({ sent: 16, total: 16, done: true, error: null });
    expect(puts).toEqual([0, 5, 10, 15]);
    expect(new Uint8Array(fs.readFileSync(path.join(env.tmpDir, `${id}.part`)))).toEqual(WEBM_BYTES);
  });

  it("retries after network errors and resumes from the server's offset", async () => {
    let calls = 0;
    const real = routeFetch();
    const upload = new ResumableUpload({
      createUrl: "/api/projects/acme/uploads",
      chunkSize: 4,
      retryDelayMs: 1,
      fetch: async (input, init) => {
        if (init?.method === "PUT") {
          calls++;
          // Lose the connection before the 2nd request arrives…
          if (calls === 2) throw new TypeError("fetch failed");
          // …and lose the response (but not the request) of the 4th.
          if (calls === 4) {
            await real(input, init);
            throw new TypeError("network changed");
          }
        }
        return real(input, init);
      },
    });
    upload.append(new Blob([WEBM_BYTES]));
    const { id } = await upload.finish();
    expect(new Uint8Array(fs.readFileSync(path.join(env.tmpDir, `${id}.part`)))).toEqual(WEBM_BYTES);
  });

  it("gives up with a readable error when the server refuses the file", async () => {
    process.env.MAX_VIDEO_MB = String(4 / (1024 * 1024));
    try {
      const upload = new ResumableUpload({ createUrl: "/api/projects/acme/uploads", retryDelayMs: 1, fetch: routeFetch() });
      upload.append(new Blob([WEBM_BYTES]));
      await expect(upload.finish()).rejects.toThrow(/larger than/);
      expect(upload.state.error).toMatch(/larger than/);
    } finally {
      delete process.env.MAX_VIDEO_MB;
    }
  });
});

describe("recording format", () => {
  const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const IPHONE_CHROME =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1";
  const MAC_SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const everything = () => true;

  it("prefers MP4 on Safari and every iOS browser, WebM elsewhere", () => {
    expect(prefersMp4(IPHONE)).toBe(true);
    expect(prefersMp4(IPHONE_CHROME)).toBe(true);
    expect(prefersMp4(MAC_SAFARI)).toBe(true);
    expect(prefersMp4(CHROME)).toBe(false);
    expect(pickMimeType(everything, IPHONE)).toMatch(/^video\/mp4/);
    expect(pickMimeType(everything, CHROME)).toBe("video/webm;codecs=vp9,opus");
  });

  it("falls back to whatever the browser supports", () => {
    expect(pickMimeType((t) => t === "video/mp4", CHROME)).toBe("video/mp4");
    expect(pickMimeType((t) => t === "video/webm", IPHONE)).toBe("video/webm");
    expect(pickMimeType(() => false, CHROME)).toBeUndefined();
    expect(
      pickMimeType(() => {
        throw new Error("not implemented");
      }, CHROME),
    ).toBeUndefined();
  });
});
