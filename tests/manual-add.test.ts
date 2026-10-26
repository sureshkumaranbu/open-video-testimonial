import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as manualRoute } from "@/app/api/admin/projects/[id]/testimonials/manual/route";
import { POST as uploadsRoute } from "@/app/api/admin/uploads/route";
import { getDb, schema } from "@/db";
import { listConsentEvents } from "@/lib/consent";
import { listImages } from "@/lib/images";
import { runDueJobs } from "@/lib/jobs";
import { addManualTestimonial, MANUAL_CONSENT_DETAIL, ManualAddError } from "@/lib/manual-add";
import { createProject, getProjectById, getTestimonial, isMediaPublic, updateProject, updateTestimonial } from "@/lib/testimonials";
import { appendChunk, createUpload, getUpload } from "@/lib/uploads";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, PNG_BYTES, useTempDataDir, WEBM_BYTES } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  getDb()
    .insert(schema.webhooks)
    .values({ id: "hook", url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: "[]", active: true, createdAt: new Date() })
    .run();
});
afterEach(() => ctx.cleanup());

const project = () => getProjectById(projectId)!;
const png = (name = "shot.png") => new File([PNG_BYTES], name, { type: "image/png" });
const sent = () => getDb().select().from(schema.webhookDeliveries).all();

async function videoUpload(project = projectId) {
  const { upload, token } = createUpload("video", { projectId: project, maxBytes: 10_000 });
  await appendChunk(upload, 0, WEBM_BYTES);
  return { id: upload.id, token };
}

function post(payload: unknown, files: Record<string, File | File[]> = {}) {
  const form = new FormData();
  form.set("payload", typeof payload === "string" ? payload : JSON.stringify(payload));
  for (const [k, v] of Object.entries(files)) for (const f of Array.isArray(v) ? v : [v]) form.append(k, f);
  return manualRoute(
    new Request(`http://localhost/api/admin/projects/${projectId}/testimonials/manual`, { method: "POST", headers: adminHeaders(), body: form }),
    params({ id: projectId }),
  );
}

describe("IMP-8.1 manual add", () => {
  it("IMP-8.1 a text testimonial goes in approved, quietly, with the consent note", async () => {
    const t = await addManualTestimonial(
      project(),
      {
        name: "Mo Manual",
        title: "CTO",
        company: "Initech",
        email: "mo@initech.example",
        rating: 5,
        headline: "Saved our launch",
        text: "We shipped a week early.",
        platform: "linkedin",
        sourceUrl: "https://www.linkedin.com/posts/123",
        sourceDate: "2026-09-01",
        datePrecision: "month",
        tags: ["Launch"],
      },
      {},
      "owner@example.com",
    );
    expect(t).toMatchObject({
      source: "manual",
      status: "approved",
      approvedBy: "owner",
      authorName: "Mo Manual",
      authorTitle: "CTO",
      authorCompany: "Initech",
      headline: "Saved our launch",
      platform: "linkedin",
      datePrecision: "month",
      tags: ["launch"],
    });
    expect(t.sourceDate?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(t.customerId).toBeTruthy();
    const events = listConsentEvents(t.id);
    expect(events.map((e) => [e.type, e.actor, e.detail])).toEqual([["imported", "owner", MANUAL_CONSENT_DETAIL]]);
    // Quiet: no webhook for adding your own testimonial.
    expect(sent()).toEqual([]);
  });

  it("IMP-8.1 the status can be chosen, and a manual one never auto-approves", async () => {
    updateProject(projectId, { autoApprove: true, autoApproveMinRating: 4, autoApproveVideo: true });
    const t = await addManualTestimonial(project(), { name: "Pat Pending", text: "Fine", rating: 5, status: "pending" }, { videoUpload: await videoUpload() });
    expect(t.status).toBe("pending");
    expect(t.videoKey).toBeTruthy();
    await runDueJobs();
    expect(getTestimonial(t.id)!.status).toBe("pending");
    expect(getTestimonial(t.id)!.mediaStatus).not.toBe("none");
  });

  it("IMP-8.1 an image testimonial keeps up to 5 images, public only once approved", async () => {
    const t = await addManualTestimonial(project(), { kind: "image", name: "Sam Screenshot", status: "pending" }, { images: [png(), png(), png()], avatar: png("me.png") });
    const images = listImages(t.id);
    expect(images.map((i) => i.questionKey)).toEqual([null, null, null]);
    expect(images.every((i) => !isMediaPublic(i.key))).toBe(true);
    expect(isMediaPublic(t.avatarKey!)).toBe(false);
    updateTestimonial(t.id, { status: "approved" });
    expect(images.every((i) => isMediaPublic(i.key))).toBe(true);
    expect(isMediaPublic(t.avatarKey!)).toBe(true);

    await expect(addManualTestimonial(project(), { kind: "image", name: "Too many" }, { images: Array.from({ length: 6 }, () => png()) })).rejects.toThrow(/at most 5/);
    await expect(addManualTestimonial(project(), { kind: "image", name: "None" }, {})).rejects.toBeInstanceOf(ManualAddError);
  });

  it("IMP-8.1 a video goes through the upload and the usual pipeline; a foreign upload is refused", async () => {
    const t = await addManualTestimonial(project(), { kind: "video", name: "Vic Video" }, { videoUpload: await videoUpload() });
    expect(t.videoKey).toMatch(/^videos\//);
    expect(t.mediaStatus === "queued" || t.mediaStatus === "skipped" || t.mediaStatus === "processing").toBe(true);
    const other = createProject({ name: "Other", slug: "other" }).id;
    const foreign = await videoUpload(other);
    await expect(addManualTestimonial(project(), { kind: "video", name: "Wrong" }, { videoUpload: foreign })).rejects.toThrow(/expired or belongs elsewhere/);
    // The refused upload is still usable by its own project.
    expect(getUpload(foreign.id, foreign.token)).not.toBeNull();
    await expect(addManualTestimonial(project(), { kind: "video", name: "No file" }, {})).rejects.toThrow(/Choose the video/);
  });

  it("IMP-8.1 the route takes multipart, and refuses bad input without leaving files behind", async () => {
    const ok = await post({ name: "Rae Route", text: "Through the route", tags: ["web"] }, { images: [png()], companyLogo: png("logo.png") });
    expect(ok.status).toBe(201);
    const { testimonial } = await ok.json();
    expect(testimonial).toMatchObject({ source: "manual", status: "approved", tags: ["web"] });
    expect(testimonial.companyLogoKey).toMatch(/^images\//);

    expect((await post({ text: "No name" })).status).toBe(400);
    expect((await post({ name: "No text" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    const before = getDb().select().from(schema.testimonials).all().length;
    const notImage = await post({ name: "Bad file", text: "x" }, { images: [new File([new Uint8Array([1, 2, 3, 4])], "x.png")] });
    expect(notImage.status).toBe(415);
    expect(getDb().select().from(schema.testimonials).all().length).toBe(before);
  });

  it("IMP-8.1 the admin upload route starts a video upload for a project", async () => {
    const start = (body: unknown, qs = "") =>
      uploadsRoute(
        new Request(`http://localhost/api/admin/uploads${qs}`, {
          method: "POST",
          headers: { ...adminHeaders(), "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const res = await start({ size: 100 }, `?kind=video&projectId=${projectId}`);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(getDb().select().from(schema.uploads).all().find((u) => u.id === id)).toMatchObject({ kind: "video", projectId });
    expect((await start({ kind: "video", projectId: "nope" })).status).toBe(404);
    expect((await start({ kind: "video", projectId, size: 10 ** 12 })).status).toBe(413);
    expect((await start({ kind: "weird" })).status).toBe(400);
    // The export-archive upload is unchanged.
    const archive = await start({ size: 100 });
    expect(archive.status).toBe(201);
  });
});
