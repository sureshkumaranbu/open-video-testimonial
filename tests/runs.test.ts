import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/runs/[id]/route";
import { getDb } from "@/db";
import { getRunProgress, MAX_RUN_ERRORS } from "@/lib/runs";
import { createProject } from "@/lib/testimonials";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
});
afterEach(() => ctx.cleanup());

const hasRunsTable = () =>
  getDb().all(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_runs'`).length > 0;

/**
 * task_runs arrives with migration 0009. Until then the tests create the same
 * columns themselves (docs/v1-implementation-plan.md §2.2); after it, they run
 * against the real table, so a renamed column fails here.
 */
function ensureRunsTable() {
  getDb().run(sql`CREATE TABLE IF NOT EXISTS task_runs (
    id text PRIMARY KEY NOT NULL,
    project_id text REFERENCES projects(id) ON DELETE cascade,
    kind text NOT NULL,
    subject text,
    input text DEFAULT '{}' NOT NULL,
    options text DEFAULT '{}' NOT NULL,
    preview text DEFAULT '[]' NOT NULL,
    selection text DEFAULT '"all"' NOT NULL,
    status text DEFAULT 'queued' NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    done integer DEFAULT 0 NOT NULL,
    duplicates integer DEFAULT 0 NOT NULL,
    skipped integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    errors text DEFAULT '[]' NOT NULL,
    cursor text,
    job_id text,
    created_by text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    finished_at integer
  )`);
}

function insertRun(r: { id: string; projectId?: string | null; status: string; total: number; done?: number; duplicates?: number; skipped?: number; failed?: number; errors?: unknown[]; finishedAt?: number }) {
  getDb().run(sql`INSERT INTO task_runs
    (id, project_id, kind, subject, input, options, status, total, done, duplicates, skipped, failed, errors, created_by, created_at, finished_at)
    VALUES (${r.id}, ${r.projectId ?? null}, 'import', 'appstore', ${JSON.stringify({ apiKey: "sk-secret-input" })},
      ${JSON.stringify({ token: "secret-option" })}, ${r.status}, ${r.total}, ${r.done ?? 0}, ${r.duplicates ?? 0},
      ${r.skipped ?? 0}, ${r.failed ?? 0}, ${JSON.stringify(r.errors ?? [])}, 'owner@example.com', 1792900000000, ${r.finishedAt ?? null})`);
}

const get = (id: string, headers: HeadersInit = adminHeaders()) =>
  GET(new Request(`http://localhost/api/admin/runs/${id}`, { headers }), params({ id }));

describe("GET /api/admin/runs/:id", () => {
  it("needs a signed-in session", async () => {
    expect((await get("anything", {})).status).toBe(401);
  });

  it("is a 404 for an unknown run, with or without the task_runs table", async () => {
    if (!hasRunsTable()) {
      expect(getRunProgress("missing")).toBeNull();
      expect((await get("missing")).status).toBe(404);
    }
    ensureRunsTable();
    const res = await get("missing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Run not found" });
  });

  it("reports progress without the run's input or options", async () => {
    ensureRunsTable();
    const project = createProject({ name: "Acme", slug: "acme" });
    insertRun({ id: "run-1", projectId: project.id, status: "running", total: 40, done: 10, duplicates: 4, skipped: 1, failed: 1, errors: ["Rate limited", { item: "r-9", message: "No text" }, 42] });

    const res = await get("run-1");
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("owner@example.com");
    expect(JSON.parse(raw).run).toEqual({
      id: "run-1",
      projectId: project.id,
      kind: "import",
      subject: "appstore",
      status: "running",
      total: 40,
      done: 10,
      duplicates: 4,
      skipped: 1,
      failed: 1,
      percent: 40,
      finished: false,
      errors: [{ message: "Rate limited" }, { item: "r-9", message: "No text" }, { message: "42" }],
      errorCount: 3,
      createdAt: new Date(1792900000000).toISOString(),
      finishedAt: null,
    });
  });

  it("shows a finished run as complete even when its total was never known", async () => {
    ensureRunsTable();
    insertRun({ id: "run-2", status: "done", total: 0, finishedAt: 1792900005000 });
    insertRun({ id: "run-3", status: "queued", total: 0 });
    expect(getRunProgress("run-2")).toMatchObject({ percent: 100, finished: true, projectId: null, finishedAt: new Date(1792900005000).toISOString() });
    expect(getRunProgress("run-3")).toMatchObject({ percent: null, finished: false });
  });

  it("caps the error list and survives a broken one", async () => {
    ensureRunsTable();
    insertRun({ id: "run-4", status: "failed", total: 5, failed: 5, errors: Array.from({ length: 30 }, (_, i) => `Error ${i}`) });
    const run = getRunProgress("run-4")!;
    expect(run.errors).toHaveLength(MAX_RUN_ERRORS);
    expect(run.errorCount).toBe(30);
    getDb().run(sql`UPDATE task_runs SET errors = 'not json' WHERE id = 'run-4'`);
    expect(getRunProgress("run-4")).toMatchObject({ errors: [], errorCount: 0, status: "failed" });
  });
});
