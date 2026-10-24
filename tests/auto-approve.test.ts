import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { PATCH as patchTestimonial } from "@/app/api/admin/testimonials/[id]/route";
import { PATCH as patchProject } from "@/app/api/admin/projects/[id]/route";
import { POST as v1Create } from "@/app/api/v1/projects/[slug]/testimonials/route";
import { getDb, schema } from "@/db";
import type { Project, Testimonial } from "@/db/schema";
import { createApiKey } from "@/lib/api-keys";
import { projectToApi } from "@/lib/api-shape";
import { autoApproveRule, checkAutoApprove, hasLink } from "@/lib/auto-approve";
import { withdrawConsent } from "@/lib/consent";
import { runDueJobs } from "@/lib/jobs";
import { queueUnprocessedVideos, resetFfmpegCheck } from "@/lib/media";
import { createRequests, requestToken } from "@/lib/requests";
import {
  createProject,
  getProjectById,
  getTestimonial,
  listPublicTestimonials,
  updateProject,
  updateTestimonial,
} from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, hasFfmpeg, params, SAMPLE_WEBM, submissionForm, submitRequest, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  resetFfmpegCheck();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.FFMPEG_PATH;
  resetFfmpegCheck();
  ctx.cleanup();
});

// ------------------------------------------------------------------ the rule

const SINCE = new Date("2026-01-01T00:00:00Z");
const on = { autoApprove: true, autoApproveMinRating: 4, autoApproveVideo: false, autoApproveSince: SINCE };
const text = {
  status: "pending",
  source: "form",
  rating: 4,
  text: "It saved us hours every week.",
  videoKey: null,
  mediaStatus: "none",
  withdrawnAt: null,
  createdAt: new Date("2026-02-01T00:00:00Z"),
} as const;
const video = { ...text, text: null, videoKey: "videos/a.webm", mediaStatus: "ready" } as const;
type P = Parameters<typeof checkAutoApprove>[0];
type T = Parameters<typeof checkAutoApprove>[1];
const check = (p: Partial<P>, t: Partial<T>) => checkAutoApprove({ ...on, ...p }, { ...text, ...t });

describe("the auto-approve rule", () => {
  it("approves a new 4-star text testimonial from the form when it's on", () => {
    expect(check({}, {})).toEqual({ approve: true, rule: "4+ stars" });
    expect(check({}, { rating: 5 })).toEqual({ approve: true, rule: "4+ stars" });
    expect(check({ autoApproveMinRating: 5 }, { rating: 5 })).toEqual({ approve: true, rule: "5 stars" });
  });

  it("does nothing while it's off", () => {
    expect(check({ autoApprove: false }, { rating: 5 })).toMatchObject({ approve: false });
    expect(check({ autoApproveSince: null }, { rating: 5 })).toMatchObject({ approve: false });
  });

  it("needs a rating of at least the minimum", () => {
    expect(check({}, { rating: null })).toEqual({ approve: false, reason: "no rating" });
    expect(check({}, { rating: 3 })).toEqual({ approve: false, reason: "rated 3, below 4" });
    expect(check({ autoApproveMinRating: 5 }, { rating: 4 })).toEqual({ approve: false, reason: "rated 4, below 5" });
  });

  it("leaves text with a link for the owner", () => {
    for (const t of ["See http://spam.example", "HTTPS://spam.example/x", "visit www.spam.example now"]) {
      expect(check({}, { text: t })).toEqual({ approve: false, reason: "the text contains a link" });
    }
    expect(hasLink("Our team (www) loved it; email us at hi@example.com")).toBe(false);
    expect(hasLink("example.com is great")).toBe(false);
  });

  it("only counts the public form and request links", () => {
    for (const source of ["api", "csv", "import", "testimonial.to"]) {
      expect(check({}, { source })).toMatchObject({ approve: false });
    }
  });

  it("only applies to testimonials sent after it was turned on", () => {
    expect(check({}, { createdAt: new Date("2025-12-31T23:59:59Z") })).toEqual({
      approve: false,
      reason: "sent before auto-approve was turned on",
    });
  });

  it("never approves a withdrawn testimonial, or one that's no longer pending", () => {
    expect(check({}, { withdrawnAt: new Date() })).toEqual({ approve: false, reason: "withdrawn" });
    expect(check({}, { status: "rejected" })).toMatchObject({ approve: false });
    expect(check({}, { status: "approved" })).toMatchObject({ approve: false });
  });

  it("approves a video only when videos are included and processing has finished", () => {
    const v = (p: Partial<P>, t: Partial<T>) => checkAutoApprove({ ...on, ...p }, { ...video, ...t });
    expect(v({}, {})).toEqual({ approve: false, reason: "videos aren't included" });
    expect(v({ autoApproveVideo: true }, {})).toEqual({ approve: true, rule: "4+ stars" });
    for (const mediaStatus of ["none", "queued", "processing"] as const) {
      expect(v({ autoApproveVideo: true }, { mediaStatus })).toEqual({ approve: false, reason: "the video is still processing" });
    }
    expect(v({ autoApproveVideo: true }, { mediaStatus: "failed" })).toEqual({ approve: false, reason: "the video couldn't be processed" });
    expect(v({ autoApproveVideo: true }, { mediaStatus: "skipped" })).toEqual({ approve: false, reason: "the video couldn't be processed" });
    expect(v({ autoApproveVideo: true }, { rating: 3 })).toMatchObject({ approve: false });
    expect(v({ autoApproveVideo: true }, { text: "and www.spam.example" })).toMatchObject({ approve: false });
  });

  it("describes the rule for the history line", () => {
    expect(autoApproveRule({ autoApproveMinRating: 4 })).toBe("4+ stars");
    expect(autoApproveRule({ autoApproveMinRating: 5 })).toBe("5 stars");
  });
});

// ------------------------------------------------------------ settings

function turnOn(settings: { minRating?: number; video?: boolean } = {}) {
  return updateProject(projectId, {
    autoApprove: true,
    autoApproveMinRating: settings.minRating ?? 4,
    autoApproveVideo: settings.video ?? false,
  })!;
}

async function send(fields: Record<string, string | File>) {
  const res = await submit(
    submitRequest("acme", submissionForm({ name: "Ada", consent: "on", ...fields })),
    params({ slug: "acme" }),
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return getTestimonial((await res.json()).id)!;
}

const admin = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { ...adminHeaders(), "content-type": "application/json" },
  });

describe("project settings", () => {
  it("are off (minimum 4, no videos) for new projects", () => {
    expect(getProjectById(projectId)).toMatchObject({
      autoApprove: false,
      autoApproveMinRating: 4,
      autoApproveVideo: false,
      autoApproveSince: null,
    });
  });

  it("are saved from the dashboard, and remember when auto-approve was turned on", async () => {
    const before = Date.now();
    const res = await patchProject(
      admin(`/api/admin/projects/${projectId}`, { autoApprove: true, autoApproveMinRating: 5, autoApproveVideo: true }),
      params({ id: projectId }),
    );
    expect(res.status).toBe(200);
    const saved = (await res.json()).project as Project & { autoApproveSince: string };
    expect(saved).toMatchObject({ autoApprove: true, autoApproveMinRating: 5, autoApproveVideo: true });
    const since = new Date(saved.autoApproveSince).getTime();
    expect(since).toBeGreaterThanOrEqual(before);

    // Saving other settings keeps the time it was turned on; turning it off clears it.
    updateProject(projectId, { name: "Acme Inc", autoApprove: true });
    expect(getProjectById(projectId)!.autoApproveSince!.getTime()).toBe(since);
    updateProject(projectId, { autoApprove: false });
    expect(getProjectById(projectId)!.autoApproveSince).toBeNull();
  });

  it("refuse a minimum other than 4 or 5", async () => {
    for (const autoApproveMinRating of [3, 6, 4.5]) {
      const res = await patchProject(admin(`/api/admin/projects/${projectId}`, { autoApproveMinRating }), params({ id: projectId }));
      expect(res.status).toBe(400);
    }
  });

  it("are part of the project in the API and webhooks", () => {
    turnOn({ minRating: 5 });
    expect(projectToApi(getProjectById(projectId)!).autoApprove).toEqual({ enabled: true, minRating: 5, includeVideo: false });
  });
});

// ----------------------------------------------------------- submissions

describe("new submissions", () => {
  it("stay pending by default, even with 5 stars", async () => {
    const t = await send({ rating: "5", text: "Brilliant" });
    expect(t).toMatchObject({ status: "pending", approvedBy: null });
  });

  it("go live straight away when they match, through the same path as the Approve button", async () => {
    turnOn();
    const four = await send({ rating: "4", text: "Very good" });
    expect(four).toMatchObject({ status: "approved", approvedBy: "auto", approvalRule: "4+ stars" });
    expect(four.approvedAt).toBeInstanceOf(Date);
    expect(listPublicTestimonials(projectId).map((t) => t.id)).toEqual([four.id]);

    expect(await send({ rating: "3", text: "Fine" })).toMatchObject({ status: "pending", approvedBy: null });
    expect(await send({ text: "No stars given" })).toMatchObject({ status: "pending" });
    expect(await send({ rating: "5", text: "Buy now at https://spam.example" })).toMatchObject({ status: "pending" });
  });

  it("respect a minimum of 5 stars", async () => {
    turnOn({ minRating: 5 });
    expect(await send({ rating: "4", text: "Very good" })).toMatchObject({ status: "pending" });
    expect(await send({ rating: "5", text: "Perfect" })).toMatchObject({ status: "approved", approvalRule: "5 stars" });
  });

  it("include ones sent through a personal request link", async () => {
    turnOn();
    const [r] = createRequests(getProjectById(projectId)!, [{ email: "bo@example.com", name: "Bo" }], { send: false }).created;
    const t = await send({ rating: "5", text: "Happy to help", requestToken: requestToken(r.id) });
    expect(t).toMatchObject({ status: "approved", approvedBy: "auto", requestId: r.id });
  });

  it("leave testimonials that were already pending alone when it's turned on", async () => {
    const earlier = await send({ rating: "5", text: "Sent before" });
    turnOn();
    await runDueJobs();
    expect(getTestimonial(earlier.id)).toMatchObject({ status: "pending" });
  });

  it("don't change what comes in through the API", async () => {
    turnOn();
    const { key } = createApiKey("zap", "write");
    const res = await v1Create(
      new Request("http://localhost/api/v1/projects/acme/testimonials", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Api", text: "Via the API", rating: 5, consent: true }),
      }),
      params({ slug: "acme" }),
    );
    expect(res.status).toBe(201);
    expect(getTestimonial((await res.json()).data.id)).toMatchObject({ status: "pending", approvedBy: null });
  });

  it("can be rejected afterwards, which takes them off the wall and clears the label", async () => {
    turnOn();
    const t = await send({ rating: "5", text: "Great" });
    const res = await patchTestimonial(admin(`/api/admin/testimonials/${t.id}`, { status: "rejected" }), params({ id: t.id }));
    expect(res.status).toBe(200);
    expect(getTestimonial(t.id)).toMatchObject({ status: "rejected", approvedBy: null, approvalRule: null, approvedAt: null });
    expect(listPublicTestimonials(projectId)).toEqual([]);
  });

  it("record who approved: the owner, the API or auto-approve", async () => {
    const t = await send({ rating: "2", text: "Meh" });
    await patchTestimonial(admin(`/api/admin/testimonials/${t.id}`, { status: "approved" }), params({ id: t.id }));
    expect(getTestimonial(t.id)).toMatchObject({ status: "approved", approvedBy: "owner", approvalRule: null });
    updateTestimonial(t.id, { status: "pending" });
    updateTestimonial(t.id, { status: "approved" }, { actor: "api" });
    expect(getTestimonial(t.id)).toMatchObject({ approvedBy: "api" });
  });

  it("withdrawing one clears its approval", async () => {
    turnOn();
    const t = await send({ rating: "5", text: "Great" });
    withdrawConsent(t.id, { actor: "customer" });
    expect(getTestimonial(t.id)).toMatchObject({ status: "rejected", approvedBy: null });
  });

  it("send testimonial.created, then testimonial.approved with approvedBy", async () => {
    getDb()
      .insert(schema.webhooks)
      .values({ id: "hook", url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: "[]", active: true, createdAt: new Date() })
      .run();
    turnOn();
    const t = await send({ rating: "5", text: "Great" });
    const rows = getDb().select().from(schema.webhookDeliveries).all();
    const payloads = rows.map((r) => JSON.parse(r.payload));
    expect(payloads.map((p) => p.event)).toEqual(["testimonial.created", "testimonial.approved"]);
    expect(payloads[0].data.testimonial).toMatchObject({ id: t.id, status: "pending", approvedBy: null });
    expect(payloads[1].data).toMatchObject({ approvedBy: "auto", testimonial: { id: t.id, status: "approved", approvedBy: "auto" } });
    // Their deliveries are queued in that order, even within one millisecond.
    const jobs = getDb().select().from(schema.jobs).all().filter((j) => j.type === "webhook.deliver");
    expect(jobs.map((j) => JSON.parse(j.payload).deliveryId)).toEqual(rows.map((r) => r.id));
  });
});

// ---------------------------------------------------------------- videos

const webm = () => new File([fs.readFileSync(SAMPLE_WEBM)], "clip.webm", { type: "video/webm" });

describe("video testimonials", () => {
  it("stay pending when videos aren't included", async () => {
    turnOn();
    const t = await send({ rating: "5", video: webm() });
    await runDueJobs();
    expect(getTestimonial(t.id)).toMatchObject({ status: "pending" });
  });

  it("stay pending when the video can't be processed", async () => {
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
    turnOn({ video: true });
    const t = await send({ rating: "5", video: webm() });
    await runDueJobs();
    expect(getTestimonial(t.id)).toMatchObject({ status: "pending", mediaStatus: "skipped" });
  });

  describe.skipIf(!hasFfmpeg())("with ffmpeg", () => {
    it("are approved only once processing has finished", async () => {
      turnOn({ video: true });
      const t = await send({ rating: "5", video: webm() });
      expect(t).toMatchObject({ status: "pending", mediaStatus: "queued" });
      await runDueJobs();
      expect(getTestimonial(t.id)).toMatchObject({ status: "approved", mediaStatus: "ready", approvedBy: "auto" });
    });

    it("stay pending when processing fails", async () => {
      turnOn({ video: true });
      const broken = new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], "bad.webm", {
        type: "video/webm",
      });
      const t = await send({ rating: "5", video: broken });
      for (let i = 0; i < 3; i++) await runDueJobs({ now: () => new Date(Date.now() + (i + 1) * 10 * 60 * 1000) });
      expect(getTestimonial(t.id)).toMatchObject({ status: "pending", mediaStatus: "failed" });
    });

    it("sent before it was turned on stay pending when they finish processing", async () => {
      updateProject(projectId, { autoApproveVideo: true });
      const t = await send({ rating: "5", video: webm() });
      turnOn({ video: true });
      await runDueJobs();
      expect(getTestimonial(t.id)).toMatchObject({ status: "pending", mediaStatus: "ready" });
    });

    it("withdrawn while processing are never approved", async () => {
      turnOn({ video: true });
      const t = await send({ rating: "5", video: webm() });
      withdrawConsent(t.id, { actor: "customer" });
      await runDueJobs();
      expect(getTestimonial(t.id)).toMatchObject({ status: "rejected", approvedBy: null });
    });

    it("with a link in the text stay pending", async () => {
      turnOn({ video: true });
      const t = await send({ rating: "5", video: webm(), text: "see www.spam.example" });
      await runDueJobs();
      expect(getTestimonial(t.id)).toMatchObject({ status: "pending", mediaStatus: "ready" });
    });

    it("processed later, not as part of their submission, stay pending", async () => {
      turnOn({ video: true });
      process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
      const t = await send({ rating: "5", video: webm() });
      expect(getTestimonial(t.id)).toMatchObject({ mediaStatus: "skipped" });
      // ffmpeg is installed later; the backlog is converted, but nobody submitted anything new.
      delete process.env.FFMPEG_PATH;
      resetFfmpegCheck();
      expect(await queueUnprocessedVideos()).toBe(1);
      await runDueJobs();
      expect(getTestimonial(t.id)).toMatchObject({ status: "pending", mediaStatus: "ready" });
    });
  });
});

// The type checker keeps the fixtures above honest about the row shapes.
void (null as unknown as Testimonial satisfies T);
