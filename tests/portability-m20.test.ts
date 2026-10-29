import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { emailHash, hasPurchase } from "@/lib/commerce/purchases";
import { createForm, getDefaultForm } from "@/lib/forms";
import { env } from "@/lib/env";
import { buildManifest, createImportTarget, exportZip, importArchive, NOT_IN_EXPORT, readManifest, STRIPE_IMPORTED } from "@/lib/portability";
import { saveFile, storage } from "@/lib/storage";
import { createProject, createTestimonial, getProjectById, getTestimonial, updateTestimonial } from "@/lib/testimonials";
import { multiclipInUse } from "@/lib/video/renders";
import { registerJobs } from "@/lib/worker";
import { zipStream } from "@/lib/zip";
import { PNG_BYTES, useTempDataDir, WEBM_BYTES } from "./helpers";

/** L21, L23, L25: the zip export carries what M16, M17 and M18 added, and older archives without it still import. */

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  process.env.PLAUDIT_FEATURES = "all";
});
afterEach(() => {
  delete process.env.PLAUDIT_FEATURES;
  ctx.cleanup();
});

const db = () => getDb();
const now = new Date("2026-10-01T10:00:00Z");
/** The start of an MP4: sniffed as video/mp4. */
const MP4_BYTES = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0]);

async function stored(bytes: Uint8Array, mime: string, kind: "image" | "video") {
  fs.mkdirSync(env.tmpDir, { recursive: true });
  const tmp = path.join(env.tmpDir, `f-${crypto.randomUUID()}`);
  fs.writeFileSync(tmp, Buffer.concat([Buffer.from(bytes), crypto.randomBytes(32)]));
  return (await saveFile(tmp, mime, kind, { move: true })).key;
}

async function exportTo(project: Project, file: string) {
  fs.writeFileSync(file, Buffer.from(await new Response(exportZip(project)).arrayBuffer()));
}
async function writeManifest(manifest: unknown, file: string) {
  const out = fs.createWriteStream(file);
  for await (const chunk of zipStream([{ name: "plaudit.json", data: JSON.stringify(manifest) }])) out.write(chunk);
  await new Promise<void>((r) => out.end(() => r()));
}
async function importAsNew(file: string) {
  const { manifest } = await readManifest(file);
  const target = createImportTarget(manifest, {});
  const counts = await importArchive(file, target.id);
  return { copy: getProjectById(target.id)!, counts };
}
const ofProject = <T extends { projectId: string }>(rows: T[], projectId: string) => rows.filter((r) => r.projectId === projectId);

async function seed() {
  const project = createProject({ name: "Acme", slug: "acme" });
  const form = getDefaultForm(project.id)!;
  const survey = createForm(project.id, { name: "NPS survey", kind: "survey" });

  // A testimonial whose video is a multiclip (VID-05), with the first answer's own file kept on the render.
  const multiclip = await stored(MP4_BYTES, "video/mp4", "video");
  const ownVideo = await stored(WEBM_BYTES, "video/webm", "video");
  const ada = createTestimonial(project.id, { name: "Ada", email: "ada@example.com", text: "Great tool, saved us 40% of our time." });
  updateTestimonial(ada.id, { status: "approved" }, { quiet: true });
  db().update(schema.testimonials).set({ videoKey: multiclip, videoOriginalKey: multiclip, videoMime: "video/mp4", mediaStatus: "ready", verifiedPurchaseAt: now }).where(eq(schema.testimonials.id, ada.id)).run();
  const render = (values: Partial<typeof schema.videoRenders.$inferInsert>) =>
    db().insert(schema.videoRenders).values({ id: crypto.randomUUID(), projectId: project.id, kind: "social", status: "ready", createdAt: now, updatedAt: now, ...values }).run();
  render({ testimonialId: ada.id, kind: "multiclip", key: multiclip, files: JSON.stringify([multiclip]), usedAsVideo: true, replacedKey: ownVideo, options: '{"answers":2}' });
  render({ testimonialId: ada.id, kind: "social", key: await stored(MP4_BYTES, "video/mp4", "video"), options: '{"look":"bold","format":"square"}' });
  render({ testimonialId: ada.id, kind: "social", status: "failed", error: "ffmpeg broke" });

  // VID-08: a reel with one clip of Ada and one of a testimonial that's gone, and its newest render.
  const reelId = crypto.randomUUID();
  const clips = [
    { testimonialId: ada.id, startMs: 0, endMs: 2000 },
    { testimonialId: crypto.randomUUID(), startMs: 0, endMs: 3000 },
  ];
  db().insert(schema.highlightReels).values({ id: reelId, projectId: project.id, name: "Launch reel", config: JSON.stringify({ format: "square", title: "Hear it from them", clips }), createdAt: now, updatedAt: now }).run();
  const reelFile = await stored(MP4_BYTES, "video/mp4", "video");
  render({ reelId, kind: "reel", key: reelFile, files: JSON.stringify([reelFile]), sizeBytes: 48, durationMs: 5000, width: 1080, height: 1080 });

  // FORM-17: the owner's welcome video, converted and captioned.
  db().insert(schema.formVideos).values({
    id: crypto.randomUUID(),
    formId: form.id,
    slot: "welcome",
    videoKey: await stored(MP4_BYTES, "video/mp4", "video"),
    videoMime: "video/mp4",
    videoOriginalKey: await stored(WEBM_BYTES, "video/webm", "video"),
    posterKey: await stored(PNG_BYTES, "image/png", "image"),
    videoDurationMs: 4000,
    mediaStatus: "ready",
    transcript: "Hello from the team",
    captionsVtt: "WEBVTT\n\n00:00.000 --> 00:02.000\nHello from the team\n",
    transcriptStatus: "ready",
    createdAt: now,
    updatedAt: now,
  }).run();

  // SHARE-04, VOC-01, NPS-01: a case study, a saved report citing Ada, and survey answers.
  const caseStudyId = crypto.randomUUID();
  db().insert(schema.caseStudies).values({ id: caseStudyId, projectId: project.id, testimonialId: ada.id, status: "published", title: "Ada and Acme", content: JSON.stringify({ pullQuote: "Great tool", metrics: [{ value: "40%", label: "time saved" }] }), aiDraftedAt: now, createdAt: now, updatedAt: now }).run();
  db().insert(schema.insightReports).values({ id: crypto.randomUUID(), projectId: project.id, kind: "ask", name: "Why they buy", params: JSON.stringify({ formId: form.id }), result: JSON.stringify({ answer: "Time", citations: [{ id: ada.id, quote: "saved us 40%" }] }), createdBy: "owner@example.com", createdAt: now }).run();
  db().insert(schema.surveyResponses).values([
    { id: crypto.randomUUID(), projectId: project.id, formId: survey.id, testimonialId: null, questionKey: "nps", score: 3, comment: "Too slow", authorName: "Bo", authorEmail: "bo@example.com", createdAt: now },
    { id: crypto.randomUUID(), projectId: project.id, formId: form.id, testimonialId: ada.id, questionKey: "nps", score: 10, comment: null, createdAt: now },
  ]).run();

  // INT-07, INT-08: the social post draft, the Stripe connection with its secrets, and purchases.
  db().insert(schema.socialDrafts).values({ testimonialId: ada.id, projectId: project.id, text: "“Great tool” — Ada", editedBy: "owner@example.com", createdAt: now, updatedAt: now }).run();
  db().insert(schema.stripeConnections).values({ id: crypto.randomUUID(), projectId: project.id, signingSecret: "whsec_topsecret_123", restrictedKey: "rk_test_restricted123", retentionDays: 30, verifyPurchases: true, defaultProduct: "Pro", lastResult: "Recorded a purchase", lastEventAt: now, createdAt: now, updatedAt: now }).run();
  db().insert(schema.purchases).values([
    { id: crypto.randomUUID(), projectId: project.id, externalId: "evt_1", eventType: "invoice.paid", firstName: "Ada", place: "London", product: "Pro", amount: 2900, currency: "gbp", emailHash: emailHash("ada@example.com"), purchasedAt: new Date(), createdAt: now },
    { id: crypto.randomUUID(), projectId: project.id, externalId: "evt_2", eventType: "checkout.session.completed", firstName: null, place: null, product: null, amount: null, currency: null, emailHash: null, purchasedAt: new Date(), createdAt: now },
  ]).run();
  return { project, form, survey, ada, caseStudyId, ownVideo, reelFile };
}

describe("L21 L23 L25 portability of M16–M18", () => {
  it("L21 VID-08 FORM-17 round-trips reels with their newest file, owner form videos, and multiclip and social clip definitions", async () => {
    const { project } = await seed();
    const file = path.join(ctx.dir, "export.zip");
    await exportTo(project, file);
    const { copy, counts } = await importAsNew(file);
    expect(counts).toMatchObject({ highlightReels: 1, formVideos: 1, renders: 3 });

    const newAda = db().select().from(schema.testimonials).where(eq(schema.testimonials.projectId, copy.id)).get()!;
    const reel = db().select().from(schema.highlightReels).where(eq(schema.highlightReels.projectId, copy.id)).get()!;
    const config = JSON.parse(reel.config);
    expect(config).toMatchObject({ format: "square", title: "Hear it from them" });
    // The clip whose testimonial didn't come is left out; the other points at the new row.
    expect(config.clips).toEqual([{ testimonialId: newAda.id, startMs: 0, endMs: 2000 }]);

    const renders = ofProject(db().select().from(schema.videoRenders).all(), copy.id);
    const reelRender = renders.find((r) => r.kind === "reel")!;
    expect(reelRender).toMatchObject({ reelId: reel.id, status: "ready", width: 1080, durationMs: 5000 });
    expect(await storage().stat(reelRender.key!)).not.toBeNull();

    // The multiclip shown as the video stays in use, with the first answer's own file to switch back to.
    const used = multiclipInUse(getTestimonial(newAda.id)!)!;
    expect(used).toMatchObject({ kind: "multiclip", status: "ready", usedAsVideo: true });
    expect(await storage().stat(used.replacedKey!)).not.toBeNull();
    // A social clip is what was asked for, to be made again; a failed one isn't carried.
    const social = renders.filter((r) => r.kind === "social");
    expect(social).toHaveLength(1);
    expect(social[0]).toMatchObject({ testimonialId: newAda.id, status: "failed", error: NOT_IN_EXPORT, key: null });
    expect(JSON.parse(social[0].options)).toEqual({ look: "bold", format: "square" });

    const fv = db().select().from(schema.formVideos).where(eq(schema.formVideos.formId, getDefaultForm(copy.id)!.id)).get()!;
    expect(fv).toMatchObject({ slot: "welcome", mediaStatus: "ready", transcript: "Hello from the team", transcriptStatus: "ready" });
    expect(fv.captionsVtt).toContain("Hello from the team");
    for (const key of [fv.videoKey!, fv.videoOriginalKey!, fv.posterKey!]) expect(await storage().stat(key)).not.toBeNull();
  });

  it("L23 SHARE-04 VOC-01 NPS-01 round-trips case studies, saved reports and survey answers, remapping every id", async () => {
    const { project, caseStudyId } = await seed();
    const file = path.join(ctx.dir, "export.zip");
    await exportTo(project, file);
    // The original's case study is gone (a move), so its id is free and /cs/ links keep working.
    db().delete(schema.caseStudies).where(eq(schema.caseStudies.id, caseStudyId)).run();
    const { copy, counts } = await importAsNew(file);
    expect(counts).toMatchObject({ caseStudies: 1, insightReports: 1, surveyResponses: 2 });
    const newAda = db().select().from(schema.testimonials).where(eq(schema.testimonials.projectId, copy.id)).get()!;

    const cs = db().select().from(schema.caseStudies).where(eq(schema.caseStudies.projectId, copy.id)).get()!;
    expect(cs).toMatchObject({ id: caseStudyId, testimonialId: newAda.id, status: "published", title: "Ada and Acme" });
    expect(JSON.parse(cs.content)).toMatchObject({ pullQuote: "Great tool", metrics: [{ value: "40%", label: "time saved" }], challenge: "" });
    expect(cs.aiDraftedAt?.toISOString()).toBe(now.toISOString());

    const report = db().select().from(schema.insightReports).where(eq(schema.insightReports.projectId, copy.id)).get()!;
    expect(JSON.parse(report.result).citations[0].id).toBe(newAda.id);
    expect(JSON.parse(report.params).formId).toBe(getDefaultForm(copy.id)!.id);

    const surveyForm = db().select().from(schema.forms).where(eq(schema.forms.projectId, copy.id)).all().find((f) => f.kind === "survey")!;
    const answers = db().select().from(schema.surveyResponses).where(eq(schema.surveyResponses.projectId, copy.id)).all();
    expect(answers.find((a) => a.score === 3)).toMatchObject({ formId: surveyForm.id, testimonialId: null, comment: "Too slow", authorEmail: "bo@example.com" });
    expect(answers.find((a) => a.score === 10)).toMatchObject({ testimonialId: newAda.id });

    // A second copy on the same server: the id is taken now, so it gets a new one.
    const again = await importAsNew(file);
    const second = db().select().from(schema.caseStudies).where(eq(schema.caseStudies.projectId, again.copy.id)).get()!;
    expect(second.id).not.toBe(caseStudyId);
  });

  it("L25 INT-07 INT-08 round-trips social drafts, Verified purchase marks, purchases and the Stripe connection without its secrets", async () => {
    const { project } = await seed();
    const manifest = buildManifest(project);
    const text = JSON.stringify(manifest);
    expect(text).not.toContain("whsec_topsecret_123");
    expect(text).not.toContain("rk_test_restricted123");
    for (const p of manifest.purchases) expect(Object.keys(p)).not.toContain("email");
    expect(manifest.stripeConnection).toEqual({ enabled: true, retentionDays: 30, verifyPurchases: true, defaultProduct: "Pro", createdAt: now.toISOString() });

    const file = path.join(ctx.dir, "export.zip");
    await exportTo(project, file);
    const { copy, counts } = await importAsNew(file);
    expect(counts).toMatchObject({ socialDrafts: 1, purchases: 2, stripeConnection: 1 });
    const newAda = db().select().from(schema.testimonials).where(eq(schema.testimonials.projectId, copy.id)).get()!;
    expect(newAda.verifiedPurchaseAt?.toISOString()).toBe(now.toISOString());
    expect(db().select().from(schema.socialDrafts).where(eq(schema.socialDrafts.testimonialId, newAda.id)).get()).toMatchObject({ projectId: copy.id, text: "“Great tool” — Ada", editedBy: "owner@example.com" });

    const c = db().select().from(schema.stripeConnections).where(eq(schema.stripeConnections.projectId, copy.id)).get()!;
    expect(c).toMatchObject({ signingSecret: "", restrictedKey: "", retentionDays: 30, defaultProduct: "Pro", lastResult: STRIPE_IMPORTED, lastEventAt: null });
    // Same server, same key: the purchases still match.
    expect(hasPurchase(copy.id, "ada@example.com")).toBe(true);
    expect(db().select().from(schema.purchases).where(eq(schema.purchases.projectId, copy.id)).all().map((p) => p.externalId).sort()).toEqual(["evt_1", "evt_2"]);

    // Another server's hashes can't match anything here, so they're dropped (the rows stay for the popup).
    const foreign = { ...manifest, purchaseKeyId: "0123456789abcdef" };
    const other = path.join(ctx.dir, "other.zip");
    await writeManifest(foreign, other);
    const moved = await importAsNew(other);
    expect(db().select().from(schema.purchases).where(eq(schema.purchases.projectId, moved.copy.id)).all().every((p) => p.emailHash === null)).toBe(true);
    expect(hasPurchase(moved.copy.id, "ada@example.com")).toBe(false);
  });

  it("L21 L23 L25 an archive from before M16 (no reels, renders, form videos, case studies, reports, answers, drafts, purchases or connection) still imports", async () => {
    const { project } = await seed();
    const manifest = buildManifest(project) as Record<string, unknown>;
    for (const k of ["highlightReels", "renders", "formVideos", "caseStudies", "insightReports", "surveyResponses", "socialDrafts", "purchaseKeyId", "purchases", "stripeConnection"]) delete manifest[k];
    for (const t of manifest.testimonials as Record<string, unknown>[]) delete t.verifiedPurchaseAt;
    const file = path.join(ctx.dir, "old.zip");
    await writeManifest(manifest, file);
    const { copy, counts } = await importAsNew(file);
    expect(counts).toMatchObject({ testimonials: 1, highlightReels: 0, renders: 0, formVideos: 0, caseStudies: 0, insightReports: 0, surveyResponses: 0, socialDrafts: 0, purchases: 0, stripeConnection: 0 });
    expect(db().select().from(schema.testimonials).where(eq(schema.testimonials.projectId, copy.id)).get()!.verifiedPurchaseAt).toBeNull();
    expect(db().select().from(schema.stripeConnections).where(eq(schema.stripeConnections.projectId, copy.id)).get()).toBeUndefined();
  });
});
