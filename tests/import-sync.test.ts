import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/admin/projects/[id]/import-sources/[sourceId]/route";
import { POST as runRoute } from "@/app/api/admin/projects/[id]/import-sources/[sourceId]/run/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/projects/[id]/import-sources/route";
import { getDb, schema } from "@/db";
import { previewImport, setImportFetch, startImport } from "@/lib/importers/run";
import { createSyncSource, failingSyncs, getSyncSource, runDueSyncs, sourceLabel, SyncError } from "@/lib/importers/sync";
import { runDueJobs } from "@/lib/jobs";
import { recordSignIn } from "@/lib/members";
import { setPrefs } from "@/lib/notifications/prefs";
import { createProject, listTestimonials } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { ADMIN_EMAIL, adminHeaders, params, useTempDataDir } from "./helpers";

const FIX = path.resolve(__dirname, "fixtures/importers");
const HOUR = 60 * 60 * 1000;

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let feed: () => { status: number; text: string };
let requested: string[];

/** The App Store feed: page 1 from the fixture (50 reviews), plus whatever `extra` entries are added on top. */
function appFeed(extra: object[] = []) {
  const page = JSON.parse(fs.readFileSync(path.join(FIX, "appstore/page1.json"), "utf8"));
  page.feed.entry = [...extra, ...page.feed.entry];
  page.feed.link = [{ attributes: { rel: "last", href: "https://itunes.apple.com/us/rss/customerreviews/page=1/id=123456789/sortby=mostrecent/json" } }];
  return { status: 200, text: JSON.stringify(page) };
}

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  requested = [];
  feed = () => appFeed();
  setImportFetch(async (url) => {
    requested.push(url);
    const a = feed();
    return { status: a.status, text: a.text, finalUrl: url, contentType: "application/json" };
  });
});
afterEach(() => {
  setImportFetch(null);
  ctx.cleanup();
});

const input = { app: "https://apps.apple.com/us/app/acme/id123456789" };
const imported = () => listTestimonials(projectId).filter((t) => t.source === "importer:appstore");
const json = (body: unknown, method = "POST") => ({ method, headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const hookDeliveries = () => getDb().select().from(schema.webhookDeliveries).all().map((d) => d.event);

async function drain(now = () => new Date()) {
  for (let i = 0; i < 30; i++) if ((await runDueJobs({ now })) === 0) break;
}

/** A finished one-off import of all matching reviews, with these options. */
async function firstImport(options: object = { tags: ["app"], status: "approved" }) {
  const preview = await previewImport(projectId, "appstore", input, options, { confirmOwnership: true });
  startImport(preview.run.id, "all");
  await drain();
  return preview.run.id;
}

describe("IMP-02 keep this in sync", () => {
  it("IMP-02 keeps a finished import's source, input and options, once, and never a file or a saved page", async () => {
    const runId = await firstImport();
    expect(imported()).toHaveLength(50);
    const res = await createRoute(new Request(`http://localhost/api/admin/projects/${projectId}/import-sources`, json({ runId, intervalHours: 12 })), params({ id: projectId }));
    expect(res.status).toBe(201);
    const { source } = await res.json();
    expect(source).toMatchObject({ adapter: "appstore", label: "123456789 · us", intervalHours: 12, paused: false, options: { tags: ["app"], status: "approved" } });
    expect((await createRoute(new Request("http://localhost/x", json({ runId })), params({ id: projectId }))).status).toBe(409);

    const upload = await previewImport(projectId, "trustpilot", {}, {}, { confirmOwnership: true, upload: { kind: "html", text: fs.readFileSync(path.join(FIX, "trustpilot/saved-page.html"), "utf8") } });
    startImport(upload.run.id, "all");
    await drain();
    expect(() => createSyncSource(projectId, upload.run.id, 24)).toThrow(SyncError);
    const yelp = await previewImport(projectId, "yelp", {}, {}, { confirmOwnership: true, upload: { kind: "html", text: fs.readFileSync(path.join(FIX, "yelp/saved.html"), "utf8") } });
    expect(() => createSyncSource(projectId, yelp.run.id, 24)).toThrow(/address or ID/);
    const other = createProject({ name: "Other", slug: "other" }).id;
    expect((await createRoute(new Request("http://localhost/x", json({ runId })), params({ id: other }))).status).toBe(404);
    expect(sourceLabel({ urls: ["a", "b"], apiKey: "secret" })).toBe("a · b");
  });

  it("IMP-02 a new review on the source appears after the next run, with the options; re-runs add nothing twice and stop at the first page with nothing new", async () => {
    getDb().insert(schema.webhooks).values({ id: crypto.randomUUID(), url: "http://127.0.0.1:9/hook", secret: "whsec_x", events: JSON.stringify(["import.completed"]), active: true, createdAt: new Date() }).run();
    const runId = await firstImport();
    const before = hookDeliveries().length;
    const s = createSyncSource(projectId, runId, 24);
    // Not due yet.
    expect(runDueSyncs()).toBe(0);

    feed = () => appFeed([{ id: { label: "fresh-review-1" }, author: { name: { label: "New Fan" } }, updated: { label: "2026-10-27T07:00:00-07:00" }, "im:rating": { label: "5" }, title: { label: "Just found it" }, content: { label: "Brilliant since the update." } }]);
    const later = new Date(Date.now() + 25 * HOUR);
    expect(runDueSyncs(later)).toBe(1);
    requested = [];
    await drain(() => later);
    const fresh = imported().find((t) => t.sourceReviewId === "fresh-review-1")!;
    expect(fresh).toMatchObject({ authorName: "New Fan", status: "approved", tags: ["app"], platform: "appstore" });
    expect(imported()).toHaveLength(51);
    expect(requested).toHaveLength(1);
    const after = getSyncSource(projectId, s.id)!;
    expect(after).toMatchObject({ lastStatus: "ok", failures: 0, itemsAdded: 1 });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(later.getTime() + 23 * HOUR);
    expect(hookDeliveries().length).toBe(before + 1);

    // Nothing new: no duplicates, and no import.completed.
    const next = new Date(later.getTime() + 25 * HOUR);
    expect(runDueSyncs(next)).toBe(1);
    await drain(() => next);
    expect(imported()).toHaveLength(51);
    expect(getSyncSource(projectId, s.id)).toMatchObject({ lastStatus: "ok", itemsAdded: 1 });
    expect(hookDeliveries().length).toBe(before + 1);
  });

  it("IMP-02 failures alert the owner after 3 misses (email and dashboard) and it keeps trying on schedule", async () => {
    recordSignIn(ADMIN_EMAIL);
    setPrefs(ADMIN_EMAIL, { importSummary: true });
    const runId = await firstImport();
    const s = createSyncSource(projectId, runId, 12);
    feed = () => ({ status: 404, text: "" });
    let t = Date.now();
    const emails = () => getDb().select().from(schema.jobs).where(eq(schema.jobs.type, "notify.email")).all().filter((j) => JSON.parse(j.payload).kind === "sync-failed");
    for (let miss = 1; miss <= 4; miss++) {
      t += 13 * HOUR;
      const now = new Date(t);
      expect(runDueSyncs(now)).toBe(1);
      await drain(() => now);
      const row = getSyncSource(projectId, s.id)!;
      expect(row).toMatchObject({ failures: miss, lastStatus: "failed" });
      expect(row.lastError).toMatch(/couldn't find that app/);
      expect(row.nextRunAt!.getTime()).toBeGreaterThan(t);
      expect(emails()).toHaveLength(miss >= 3 ? 1 : 0);
      expect(failingSyncs([projectId]).map((f) => f.id)).toEqual(miss >= 3 ? [s.id] : []);
    }
    // Working again clears the alert.
    feed = () => appFeed();
    t += 13 * HOUR;
    runDueSyncs(new Date(t));
    await drain(() => new Date(t));
    expect(getSyncSource(projectId, s.id)).toMatchObject({ failures: 0, lastStatus: "ok", alertedAt: null });
    expect(failingSyncs([projectId])).toEqual([]);
  });

  it("IMP-02 pause, resume, run now, change the interval and stop syncing", async () => {
    const runId = await firstImport();
    const s = createSyncSource(projectId, runId, 24);
    const url = `http://localhost/api/admin/projects/${projectId}/import-sources/${s.id}`;
    const p = params({ id: projectId, sourceId: s.id });
    expect((await patchRoute(new Request(url, json({ paused: true }, "PATCH")), p)).status).toBe(200);
    expect(runDueSyncs(new Date(Date.now() + 48 * HOUR))).toBe(0);
    const resumed = await (await patchRoute(new Request(url, json({ paused: false, intervalHours: 12 }, "PATCH")), p)).json();
    expect(resumed.source).toMatchObject({ paused: false, intervalHours: 12 });
    expect((await patchRoute(new Request(url, json({ intervalHours: 6 }, "PATCH")), p)).status).toBe(400);

    const first = await runRoute(new Request(`${url}/run`, { method: "POST", headers: adminHeaders() }), p);
    expect(first.status).toBe(202);
    const { runId: running } = await first.json();
    const again = await (await runRoute(new Request(`${url}/run`, { method: "POST", headers: adminHeaders() }), p)).json();
    expect(again.runId).toBe(running);
    const list = await (await listRoute(new Request(`http://localhost/api/admin/projects/${projectId}/import-sources`, { headers: adminHeaders() }), params({ id: projectId }))).json();
    expect(list.sources[0]).toMatchObject({ id: s.id, running: true });

    const other = createProject({ name: "Other", slug: "other" }).id;
    expect((await deleteRoute(new Request(url, { method: "DELETE", headers: adminHeaders() }), params({ id: other, sourceId: s.id }))).status).toBe(404);
    expect((await deleteRoute(new Request(url, { method: "DELETE", headers: adminHeaders() }), p)).status).toBe(204);
    expect(getDb().select().from(schema.taskRuns).where(eq(schema.taskRuns.id, running)).get()!.sourceId).toBeNull();
  });
});
