import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as captions } from "@/app/api/captions/[id]/route";
import { PATCH } from "@/app/api/admin/testimonials/[id]/route";
import { POST as transcribeRoute } from "@/app/api/admin/testimonials/[id]/transcribe/route";
import { GET as widget } from "@/app/api/widget/[slug]/route";
import { env } from "@/lib/env";
import { runDueJobs } from "@/lib/jobs";
import { queueVideoProcessing, resetFfmpegCheck } from "@/lib/media";
import { saveFile } from "@/lib/storage";
import { createProject, createTestimonial, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, hasFfmpeg, params, SAMPLE_WEBM, useTempDataDir } from "./helpers";

const FAKE_WHISPER = path.resolve(__dirname, "../e2e/fixtures/fake-whisper.mjs");

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetFfmpegCheck();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  for (const k of ["TRANSCRIBE_PROVIDER", "TRANSCRIBE_COMMAND", "TRANSCRIBE_API_URL", "TRANSCRIBE_API_KEY", "TRANSCRIBE_MODEL", "TRANSCRIBE_LANGUAGE"]) {
    delete process.env[k];
  }
  ctx.cleanup();
});

async function videoTestimonial() {
  const stored = await saveFile(SAMPLE_WEBM, "video/webm", "video");
  return createTestimonial(projectId, { name: "Ada", videoKey: stored.key, videoMime: stored.mime });
}

function admin(url: string, init: RequestInit = {}) {
  return new Request(`http://localhost${url}`, { ...init, headers: { ...adminHeaders(), "content-type": "application/json" } });
}

describe.skipIf(!hasFfmpeg())("transcription (needs ffmpeg)", () => {
  it("runs a local command (like whisper.cpp) after conversion and stores captions", async () => {
    process.env.TRANSCRIBE_PROVIDER = "command";
    process.env.TRANSCRIBE_COMMAND = `"${process.execPath}" ${FAKE_WHISPER} {input} {output}`;
    const t = await videoTestimonial();
    await queueVideoProcessing(t.id);
    await runDueJobs();

    const done = getTestimonial(t.id)!;
    expect(done.transcriptStatus).toBe("ready");
    expect(done.transcript).toBe("This is a stand-in transcript. It proves the audio reached the transcriber.");
    expect(done.captionsVtt).toMatch(/^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.500\n/);
    // Temporary audio is cleaned up.
    expect(fs.readdirSync(env.tmpDir).filter((f) => f.startsWith("audio-"))).toEqual([]);

    // Captions are public only once approved.
    const vtt = () => captions(new Request(`http://localhost/api/captions/${t.id}`), params({ id: t.id }));
    expect((await vtt()).status).toBe(404);
    updateTestimonial(t.id, { status: "approved" });
    const res = await vtt();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toBe(done.captionsVtt);

    const feed = await (await widget(new Request("http://localhost/api/widget/acme"), params({ slug: "acme" }))).json();
    expect(feed.testimonials[0].video).toMatchObject({
      captionsUrl: `/api/captions/${t.id}`,
      transcript: done.transcript,
    });
  });

  it("calls an OpenAI-compatible API with the audio and asks for WebVTT", async () => {
    const seen: { auth?: string; body: string; url?: string } = { body: "" };
    const server = http.createServer((req, res) => {
      seen.auth = req.headers.authorization;
      seen.url = req.url;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.body = Buffer.concat(chunks).toString("latin1");
        res.writeHead(200, { "content-type": "text/vtt" });
        res.end("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFrom the API.\n");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      process.env.TRANSCRIBE_PROVIDER = "openai";
      process.env.TRANSCRIBE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
      process.env.TRANSCRIBE_API_KEY = "sk-test";
      process.env.TRANSCRIBE_MODEL = "whisper-test";
      process.env.TRANSCRIBE_LANGUAGE = "en";
      const t = await videoTestimonial();
      const res = await transcribeRoute(admin(`/api/admin/testimonials/${t.id}/transcribe`, { method: "POST" }), params({ id: t.id }));
      expect(res.status).toBe(200);
      await runDueJobs();
      expect(getTestimonial(t.id)).toMatchObject({ transcriptStatus: "ready", transcript: "From the API." });
      expect(seen.url).toBe("/v1/audio/transcriptions");
      expect(seen.auth).toBe("Bearer sk-test");
      for (const [field, value] of [["model", "whisper-test"], ["response_format", "vtt"], ["language", "en"]]) {
        expect(seen.body).toMatch(new RegExp(`name="${field}"\\r\\n\\r\\n${value}\\r\\n`));
      }
      expect(seen.body).toContain('filename="audio.wav"');
      expect(seen.body).toContain("RIFF");
    } finally {
      server.close();
    }
  });

  it("records a failure and doesn't retry a rejected API key", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"error":"bad key"}');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      process.env.TRANSCRIBE_PROVIDER = "openai";
      process.env.TRANSCRIBE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const t = await videoTestimonial();
      await transcribeRoute(admin(`/api/admin/testimonials/${t.id}/transcribe`, { method: "POST" }), params({ id: t.id }));
      await runDueJobs();
      expect(getTestimonial(t.id)).toMatchObject({ transcriptStatus: "failed", transcriptError: expect.stringContaining("401") });
    } finally {
      server.close();
    }
  });

  it("explains when the video has no sound", async () => {
    process.env.TRANSCRIBE_PROVIDER = "command";
    process.env.TRANSCRIBE_COMMAND = `"${process.execPath}" ${FAKE_WHISPER} {input} {output}`;
    const silent = path.join(ctx.dir, "silent.webm");
    const { execFileSync } = await import("node:child_process");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=5:duration=1", "-c:v", "libvpx", "-y", silent]);
    const stored = await saveFile(silent, "video/webm", "video");
    const t = createTestimonial(projectId, { name: "Mute", videoKey: stored.key, videoMime: stored.mime });
    await transcribeRoute(admin(`/api/admin/testimonials/${t.id}/transcribe`, { method: "POST" }), params({ id: t.id }));
    await runDueJobs();
    expect(getTestimonial(t.id)).toMatchObject({ transcriptStatus: "failed", transcriptError: "The video has no sound to transcribe" });
  });
});

describe("editing transcripts and captions", () => {
  it("normalises pasted SRT, rejects junk, and can use the transcript as the quote", async () => {
    const t = await videoTestimonial();
    const patch = (body: unknown) =>
      PATCH(admin(`/api/admin/testimonials/${t.id}`, { method: "PATCH", body: JSON.stringify(body) }), params({ id: t.id }));

    let res = await patch({ transcript: "Typed by the owner.", captionsVtt: "1\n00:00:00,000 --> 00:00:01,000\nHi\n" });
    expect(res.status).toBe(200);
    expect(getTestimonial(t.id)).toMatchObject({
      transcript: "Typed by the owner.",
      captionsVtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n",
    });

    res = await patch({ captionsVtt: "not captions" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/WebVTT/);

    await patch({ text: "Typed by the owner." });
    expect(getTestimonial(t.id)!.text).toBe("Typed by the owner.");

    await patch({ captionsVtt: "" });
    expect(getTestimonial(t.id)!.captionsVtt).toBeNull();
  });

  it("refuses to transcribe when no provider is configured", async () => {
    const t = await videoTestimonial();
    const res = await transcribeRoute(admin(`/api/admin/testimonials/${t.id}/transcribe`, { method: "POST" }), params({ id: t.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/TRANSCRIBE_PROVIDER/);
  });
});
