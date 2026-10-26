import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as importersRoute } from "@/app/api/admin/importers/route";
import { GET as listRunsRoute } from "@/app/api/admin/projects/[id]/imports/route";
import { POST as previewRoute } from "@/app/api/admin/projects/[id]/imports/preview/route";
import { GET as runRoute } from "@/app/api/admin/runs/[id]/route";
import { POST as startRoute } from "@/app/api/admin/runs/[id]/import/route";
import { getDb, schema } from "@/db";
import { FETCH_MEDIA_JOB } from "@/lib/csv-import";
import { runDueJobs } from "@/lib/jobs";
import { listImporters } from "@/lib/importers/registry";
import { IMPORT_PLATFORM_JOB, previewImport, runImportJob, setImportFetch, startImport } from "@/lib/importers/run";
import type { PublicText } from "@/lib/net-guard";
import { createProject, listTestimonials } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

const FIX = path.resolve(__dirname, "fixtures/importers");
const read = (p: string) => fs.readFileSync(path.join(FIX, p), "utf8");

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let requested: string[];

/** Answers the App Store feed from the fixtures: page 1 has 50 reviews, page 2 has 10. */
function fakeFetch(map: Record<string, () => PublicText | Promise<PublicText>> = {}) {
  setImportFetch(async (url) => {
    requested.push(url);
    for (const [pattern, answer] of Object.entries(map)) if (url.includes(pattern)) return answer();
    const page = /customerreviews\/page=(\d+)\//.exec(url)?.[1];
    if (page === "1" || page === "2") return { status: 200, text: read(`appstore/page${page}.json`), finalUrl: url, contentType: "application/json" };
    return { status: 404, text: "", finalUrl: url, contentType: "text/plain" };
  });
}

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  requested = [];
  fakeFetch();
});
afterEach(() => {
  setImportFetch(null);
  ctx.cleanup();
});

const appInput = { app: "https://apps.apple.com/us/app/acme/id123456789" };
const own = { confirmOwnership: true as const };

function hook(events: string[]) {
  const id = crypto.randomUUID();
  getDb()
    .insert(schema.webhooks)
    .values({ id, url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: JSON.stringify(events), active: true, createdAt: new Date() })
    .run();
  return id;
}
const deliveries = () => getDb().select().from(schema.webhookDeliveries).all().map((d) => [d.webhookId, d.event]);
const jobsOf = (type: string) => getDb().select().from(schema.jobs).where(eq(schema.jobs.type, type)).all();
const imported = () => listTestimonials(projectId).filter((t) => t.source === "importer:appstore");

/** Media downloads would reach the network; these tests only check they're queued. */
const dropMediaJobs = () => getDb().delete(schema.jobs).where(eq(schema.jobs.type, FETCH_MEDIA_JOB)).run();

async function drain() {
  for (let i = 0; i < 20; i++) if ((await runDueJobs()) === 0) break;
}

function post(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, { method: "POST", headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("IMP-01 importer framework", () => {
  it("IMP-01 lists every source with its method and terms, and whether it's set up", async () => {
    const res = await importersRoute(new Request("http://localhost/api/admin/importers", { headers: adminHeaders() }));
    const { importers } = await res.json();
    expect(importers.map((i: { id: string }) => i.id)).toEqual(["google", "trustpilot", "g2", "capterra", "producthunt", "appstore", "googleplay", "x", "testimonial-to", "senja", "shapo"]);
    expect(listImporters().every((i) => i.method && typeof i.tosNotes === "string")).toBe(true);
    // The onboarding wizard's website source is never offered here.
    expect(importers.some((i: { id: string }) => i.id === "website")).toBe(false);
  });

  it("IMP-01 preview → select → import: 50 previewed, 20 imported with progress through task_runs", async () => {
    const res = await previewRoute(post(`/api/admin/projects/${projectId}/imports/preview`, { adapter: "appstore", input: appInput, options: {}, ...own }), params({ id: projectId }));
    expect(res.status).toBe(201);
    const preview = await res.json();
    expect(preview.items).toHaveLength(50);
    expect(preview.more).toBe(true);
    expect(preview.run.status).toBe("previewed");
    // The preview stops at 50 matching: page 2 isn't fetched.
    expect(requested).toHaveLength(1);
    const chosen = preview.items.slice(0, 20).map((i: { id: string }) => i.id);

    const started = await startRoute(post(`/api/admin/runs/${preview.run.id}/import`, { selection: chosen }), params({ id: preview.run.id }));
    expect(started.status).toBe(200);
    expect((await started.json()).run).toMatchObject({ status: "queued", total: 20 });
    await drain();

    const progress = await (await runRoute(new Request(`http://localhost/api/admin/runs/${preview.run.id}`, { headers: adminHeaders() }), params({ id: preview.run.id }))).json();
    expect(progress.run).toMatchObject({ status: "done", total: 20, done: 20, duplicates: 0, percent: 100, finished: true });
    const rows = imported();
    expect(rows).toHaveLength(20);
    expect(rows.every((t) => t.platform === "appstore" && t.status === "pending" && t.importedAt && t.sourceReviewId)).toBe(true);
    expect(new Set(rows.map((t) => t.sourceReviewId))).toEqual(new Set(chosen));
    // "&amp;" in the feed is text, not markup.
    expect(rows.find((t) => t.headline?.startsWith("Love it"))?.headline).toBe("Love it & use it daily");
    const consent = getDb().select().from(schema.consentEvents).where(eq(schema.consentEvents.testimonialId, rows[0].id)).all();
    expect(consent.map((c) => c.type)).toContain("imported");

    const history = await (await listRunsRoute(new Request(`http://localhost/api/admin/projects/${projectId}/imports`, { headers: adminHeaders() }), params({ id: projectId }))).json();
    expect(history.runs).toHaveLength(1);
  });

  it("IMP-01 a re-run dedupes and counts the duplicates: 0 new, 20 already imported", async () => {
    const first = await previewImport(projectId, "appstore", appInput, {}, own);
    const chosen = first.items.slice(0, 20).map((i) => i.id);
    startImport(first.run.id, chosen);
    await drain();

    const again = await previewImport(projectId, "appstore", appInput, {}, own);
    expect(again.items.filter((i) => i.alreadyImported).map((i) => i.id).sort()).toEqual([...chosen].sort());
    startImport(again.run.id, chosen);
    await drain();
    const run = getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, again.run.id)).get()!;
    expect(run).toMatchObject({ status: "done", done: 0, duplicates: 20 });
    expect(imported()).toHaveLength(20);
  });

  it("IMP-01 import all matching walks every page in chunks, re-enqueuing itself with a cursor", async () => {
    const preview = await previewImport(projectId, "appstore", appInput, {}, own);
    startImport(preview.run.id, "all");
    await drain();
    const run = getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, preview.run.id)).get()!;
    expect(run).toMatchObject({ status: "done", done: 60, total: 60, cursor: null });
    // One job per page (50 + 10).
    expect(jobsOf(IMPORT_PLATFORM_JOB)).toHaveLength(2);
    expect(imported()).toHaveLength(60);
    // Saved inputs and previews are dropped once the run ends.
    expect(run.preview).toBe("[]");
  });

  it("IMP-01 a repeated or stale job never imports or counts an item twice", async () => {
    const preview = await previewImport(projectId, "appstore", appInput, {}, own);
    startImport(preview.run.id, "all");
    await runImportJob({ runId: preview.run.id });
    await runImportJob({ runId: preview.run.id });
    await runImportJob({ runId: preview.run.id });
    const run = getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, preview.run.id)).get()!;
    expect(run).toMatchObject({ status: "done", done: 60, duplicates: 0 });
    expect(imported()).toHaveLength(60);
  });

  it("IMP-01 options: minimum rating, skip empty, tags and status on import", async () => {
    const preview = await previewImport(projectId, "appstore", appInput, { minRating: 4, tags: ["App Store"], status: "approved" }, own);
    expect(preview.items.every((i) => (i.rating ?? 0) >= 4)).toBe(true);
    startImport(preview.run.id, "all");
    await drain();
    const run = getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, preview.run.id)).get()!;
    const rows = imported();
    expect(rows.length).toBe(run.done);
    expect(run.skipped).toBe(60 - run.done);
    expect(run.skipped).toBeGreaterThan(0);
    expect(rows.every((t) => t.status === "approved" && t.tags.includes("app store") && (t.rating ?? 0) >= 4)).toBe(true);

    // Skip empty drops items with no text.
    fakeFetch({
      "/rss/": () => ({
        status: 200,
        text: JSON.stringify({ feed: { entry: [{ id: { label: "e1" }, "im:rating": { label: "5" }, author: { name: { label: "Silent" } }, title: { label: "Five" }, content: { label: "" } }, { id: { label: "e2" }, "im:rating": { label: "5" }, author: { name: { label: "Chatty" } }, content: { label: "Words" } }] } }),
        finalUrl: "",
        contentType: "application/json",
      }),
    });
    const empty = await previewImport(projectId, "appstore", appInput, { skipEmpty: true }, own);
    expect(empty.items.map((i) => i.authorName)).toEqual(["Chatty"]);
  });

  it("IMP-03 confirmOwnership is required: the server answers 400 without it", async () => {
    for (const confirmOwnership of [undefined, false, "true"]) {
      const res = await previewRoute(post(`/api/admin/projects/${projectId}/imports/preview`, { adapter: "appstore", input: appInput, confirmOwnership }), params({ id: projectId }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("ownership");
    }
    expect(requested).toHaveLength(0);
    // Multipart uploads are checked the same way.
    const form = new FormData();
    form.set("adapter", "appstore");
    form.set("html", new File(["<html></html>"], "page.html", { type: "text/html" }));
    const res = await previewRoute(new Request(`http://localhost/api/admin/projects/${projectId}/imports/preview`, { method: "POST", headers: adminHeaders(), body: form }), params({ id: projectId }));
    expect(res.status).toBe(400);
  });

  it("IMP-01 a run starts once; a second start is refused (409) and a foreign selection 400", async () => {
    const preview = await previewImport(projectId, "appstore", appInput, {}, own);
    const bad = await startRoute(post(`/api/admin/runs/${preview.run.id}/import`, { selection: ["not-in-preview"] }), params({ id: preview.run.id }));
    expect(bad.status).toBe(400);
    expect((await startRoute(post(`/api/admin/runs/${preview.run.id}/import`, { selection: "all" }), params({ id: preview.run.id }))).status).toBe(200);
    expect((await startRoute(post(`/api/admin/runs/${preview.run.id}/import`, { selection: "all" }), params({ id: preview.run.id }))).status).toBe(409);
    expect(jobsOf(IMPORT_PLATFORM_JOB)).toHaveLength(1);
  });

  it("IMP-01 one opt-in import.completed per run and no per-row webhooks", async () => {
    const catchAll = hook([]);
    const optIn = hook(["import.completed"]);
    const preview = await previewImport(projectId, "appstore", appInput, {}, own);
    startImport(preview.run.id, "all");
    await drain();
    // Runs again on a stale job: still one event.
    await runImportJob({ runId: preview.run.id });
    expect(deliveries()).toEqual([[optIn, "import.completed"]]);
    expect(deliveries().some(([id]) => id === catchAll)).toBe(false);
    const body = JSON.parse(getDb().select().from(schema.webhookDeliveries).get()!.payload);
    expect(body.data.import).toMatchObject({ id: preview.run.id, source: "appstore", imported: 60, duplicates: 0 });
  });

  it("IMP-01 a source that fails answers 502, and input it can't use answers 400", async () => {
    fakeFetch({ "page=1": () => ({ status: 503, text: "busy", finalUrl: "", contentType: "text/plain" }) });
    const res = await previewRoute(post(`/api/admin/projects/${projectId}/imports/preview`, { adapter: "appstore", input: appInput, ...own }), params({ id: projectId }));
    expect(res.status).toBe(502);
    const missing = await previewRoute(post(`/api/admin/projects/${projectId}/imports/preview`, { adapter: "appstore", input: { app: "not an app" }, ...own }), params({ id: projectId }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBe("input");
  });

  it("IMP-01 a deleted project or run leaves the job with nothing to do", async () => {
    const preview = await previewImport(projectId, "appstore", appInput, {}, own);
    startImport(preview.run.id, "all");
    getDb().delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
    await expect(drain()).resolves.toBeUndefined();
    expect(getDb().select().from(schema.testimonials).where(and(eq(schema.testimonials.projectId, projectId))).all()).toHaveLength(0);
    expect(jobsOf(FETCH_MEDIA_JOB)).toHaveLength(0);
  });

  it("IMP-01 migrations bring videos and avatars through import.media, and drop the API key afterwards", async () => {
    fakeFetch({ "api.senja.io": () => ({ status: 200, text: read("senja/api-page1.json"), finalUrl: "", contentType: "application/json" }) });
    const preview = await previewImport(projectId, "senja", { apiKey: "senja-key-123" }, {}, own);
    expect(preview.items.map((i) => i.id)).toEqual(["sj_001", "sj_002", "sj_003"]);
    startImport(preview.run.id, "all");
    await runDueJobs({ limit: 1 });
    const media = jobsOf(FETCH_MEDIA_JOB).map((j) => JSON.parse(j.payload));
    expect(media).toEqual([
      expect.objectContaining({ videoUrl: "https://cdn.senja-fixture.example/grace.mp4", avatarUrl: "https://cdn.senja-fixture.example/grace.png" }),
    ]);
    const rows = listTestimonials(projectId);
    expect(rows.find((t) => t.sourceReviewId === "sj_002")).toMatchObject({ platform: "google", source: "importer:senja", datePrecision: "month" });
    expect(rows.find((t) => t.sourceReviewId === "sj_001")).toMatchObject({ platform: "senja", headline: "Changed how we onboard" });
    const run = getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, preview.run.id)).get()!;
    expect(run.status).toBe("done");
    expect(run.input).not.toContain("senja-key-123");
  });

  it("IMP-05 the saved-page upload previews with a month-only date and imports what it held", async () => {
    const form = new FormData();
    form.set("adapter", "trustpilot");
    form.set("confirmOwnership", "true");
    form.set("options", JSON.stringify({ status: "approved" }));
    form.set("html", new File([read("trustpilot/saved-page.html")], "acme.html", { type: "text/html" }));
    const res = await previewRoute(new Request(`http://localhost/api/admin/projects/${projectId}/imports/preview`, { method: "POST", headers: adminHeaders(), body: form }), params({ id: projectId }));
    expect(res.status).toBe(201);
    const preview = await res.json();
    expect(requested).toHaveLength(0);
    expect(preview.items.find((i: { id: string }) => i.id === "6a00000000000000000000b2")).toMatchObject({ datePrecision: "month", date: "2026-10-01T00:00:00.000Z" });
    startImport(preview.run.id, "all");
    // One chunk; the media jobs it queues stay queued.
    await runDueJobs({ limit: 1 });
    const rows = listTestimonials(projectId);
    expect(rows).toHaveLength(3);
    expect(rows.every((t) => t.platform === "trustpilot" && t.status === "approved")).toBe(true);
    // An unsafe avatar link in the page is never fetched.
    expect(jobsOf(FETCH_MEDIA_JOB).map((j) => JSON.parse(j.payload).avatarUrl)).toEqual(["https://user-images.example/lena.png"]);
  });

  it("IMP-01 an export file goes through the source's preset, and re-uploading it adds nothing", async () => {
    const upload = async () => {
      const form = new FormData();
      form.set("adapter", "shapo");
      form.set("confirmOwnership", "true");
      form.set("file", new File([read("shapo/export.csv")], "shapo.csv", { type: "text/csv" }));
      const res = await previewRoute(new Request(`http://localhost/api/admin/projects/${projectId}/imports/preview`, { method: "POST", headers: adminHeaders(), body: form }), params({ id: projectId }));
      expect(res.status).toBe(201);
      return res.json();
    };
    const first = await upload();
    startImport(first.run.id, "all");
    await runDueJobs({ limit: 1 });
    dropMediaJobs();
    const second = await upload();
    expect(second.items.every((i: { alreadyImported: boolean }) => i.alreadyImported)).toBe(true);
    startImport(second.run.id, "all");
    await drain();
    expect(getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, second.run.id)).get()).toMatchObject({ done: 0, duplicates: 2 });
    expect(listTestimonials(projectId).map((t) => t.platform).sort()).toEqual(["google", "trustpilot"]);
  });
});
