import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as captionsRoute } from "@/app/api/captions/[id]/route";
import { POST as submitRoute } from "@/app/api/projects/[slug]/forms/[form]/submissions/route";
import { getDb, schema } from "@/db";
import { listAnswers } from "@/lib/answers";
import { env } from "@/lib/env";
import { createForm, updateForm } from "@/lib/forms";
import { formPagesSchema, parseFormRow } from "@/lib/forms/schema";
import { runDueJobs } from "@/lib/jobs";
import { resetRateLimits } from "@/lib/rate-limit";
import { createProject, deleteTestimonial, getTestimonial, isMediaPublic, updateTestimonial } from "@/lib/testimonials";
import { appendChunk, createUpload } from "@/lib/uploads";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, formSubmission, hasFfmpeg, params, SAMPLE_WEBM, submitFormRequest, useTempDataDir, WEBM_BYTES } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  resetRateLimits();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => ctx.cleanup());

const exists = (key: string | null) => Boolean(key) && fs.existsSync(path.join(env.uploadsDir, key!));

function makeForm(autoApprove?: { mode: "all"; includeVideo: boolean }) {
  const form = createForm(projectId, { name: "Video form", slug: "video" });
  const cfg = parseFormRow(form);
  return updateForm(form.id, {
    pages: formPagesSchema.parse([
      { type: "question", key: "q1", primary: true, title: "Tell us", mode: "text" },
      { type: "question", key: "q2", title: "Say hi", mode: "video" },
      { type: "consent" },
      { type: "about_you" },
      { type: "thank_you" },
    ]),
    settings: { ...cfg.settings, ...(autoApprove ? { autoApprove: { ...cfg.settings.autoApprove, ...autoApprove } } : {}) },
  })!;
}

async function submitWithVideo(bytes: Uint8Array) {
  const { upload, token } = createUpload("video", { projectId, maxBytes: 50 * 1024 * 1024 });
  await appendChunk(upload, 0, bytes);
  const payload = {
    answers: [{ key: "q1", text: "Hello" }, { key: "q2", videoUpload: upload.id, videoUploadToken: token }],
    person: { name: "Vid" },
    consent: { agreed: true },
  };
  const res = await submitRoute(submitFormRequest("acme", "video", formSubmission(payload)), params({ slug: "acme", form: "video" }));
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

describe("answer media", () => {
  it("FORM-04 an answer's captions need a session (answer videos are owner-only, D13)", async () => {
    makeForm();
    const id = await submitWithVideo(WEBM_BYTES);
    const [answer] = listAnswers(id);
    getDb().update(schema.answers).set({ captionsVtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n" }).where(eq(schema.answers.id, answer.id)).run();
    updateTestimonial(id, { status: "approved" });
    const url = `http://localhost/api/captions/${id}?answer=${answer.id}`;
    expect((await captionsRoute(new Request(url), params({ id }))).status).toBe(404);
    const owner = await captionsRoute(new Request(url, { headers: adminHeaders() }), params({ id }));
    expect(owner.status).toBe(200);
    expect(await owner.text()).toContain("Hi");
    // Even approved, the answer's file isn't public.
    expect(isMediaPublic(answer.videoKey!)).toBe(false);
  });

  it("FORM-04 deleting the testimonial deletes its answers' files", async () => {
    makeForm();
    const id = await submitWithVideo(WEBM_BYTES);
    const [answer] = listAnswers(id);
    expect(exists(answer.videoKey)).toBe(true);
    await deleteTestimonial(id);
    expect(exists(answer.videoKey)).toBe(false);
    expect(listAnswers(id)).toEqual([]);
  });
});

describe.skipIf(!hasFfmpeg())("answer videos with ffmpeg", () => {
  it("FORM-04 the answer job converts the video and makes a poster", async () => {
    makeForm();
    const id = await submitWithVideo(new Uint8Array(fs.readFileSync(SAMPLE_WEBM)));
    expect(listAnswers(id)[0].mediaStatus).toBe("queued");
    await runDueJobs();
    const [a] = listAnswers(id);
    expect(a).toMatchObject({ mediaStatus: "ready", videoMime: "video/mp4" });
    expect(a.videoKey).toMatch(/\.mp4$/);
    expect(exists(a.posterKey)).toBe(true);
    expect(exists(a.videoOriginalKey)).toBe(true);
  });

  it("FORM-10 auto-approve waits for every answer's video", async () => {
    makeForm({ mode: "all", includeVideo: true });
    const id = await submitWithVideo(new Uint8Array(fs.readFileSync(SAMPLE_WEBM)));
    expect(getTestimonial(id)?.status).toBe("pending");
    await runDueJobs();
    expect(getTestimonial(id)).toMatchObject({ status: "approved", approvedBy: "auto" });
  });

  it("FORM-10 a rule that leaves videos out never approves a video answer", async () => {
    makeForm({ mode: "all", includeVideo: false });
    const id = await submitWithVideo(new Uint8Array(fs.readFileSync(SAMPLE_WEBM)));
    await runDueJobs();
    expect(getTestimonial(id)?.status).toBe("pending");
  });
});
