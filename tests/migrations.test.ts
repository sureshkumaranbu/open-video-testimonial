import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as widgetFeed } from "@/app/api/widget/[slug]/route";
import { getDb } from "@/db";
import { env } from "@/lib/env";
import { getDefaultForm } from "@/lib/forms";
import { formConfigFromProject, primaryQuestion } from "@/lib/forms/defaults";
import { DEFAULT_QUESTIONS } from "@/lib/forms/legacy";
import { parseFormRow } from "@/lib/forms/schema";
import { getProjectById, listPublicTestimonials } from "@/lib/testimonials";
import { checkMigrations } from "../scripts/check-migrations.mjs";
import { checkSchemaDrift } from "../scripts/check-schema-drift.mjs";
import { MIGRATIONS_DIR, params, useMigrationsUpTo, useTempDataDir } from "./helpers";

/**
 * Guards for drizzle/ and an upgrade rehearsal. The migrator runs every pending
 * file in one BEGIN with foreign_keys=ON, so a table rebuild silently cascades
 * deletes into child tables, and a skewed journal `when` makes existing
 * databases skip a migration while fresh ones (and every other test) pass.
 */

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
const journal = () => JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: JournalEntry[] };

/** The 15 tables that existed at migration 0008 (Phase 1 only adds tables and columns). */
const OLD_TABLES = [
  "projects", "testimonials", "tags", "testimonial_tags", "consent_versions", "consent_events", "requests", "api_keys",
  "webhooks", "webhook_deliveries", "jobs", "uploads", "members", "login_tokens", "oauth_flows",
];

const rows = <T = Record<string, unknown>>(query: string) => getDb().all<T>(sql.raw(query));
const tableExists = (name: string) => rows(`SELECT name FROM sqlite_master WHERE name = '${name}'`).length > 0;

describe("migration files", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plaudit-mig-check-"));
    fs.cpSync(MIGRATIONS_DIR, tmp, { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** Appends a migration to the copy in `tmp`, as drizzle-kit would. */
  function addMigration(tag: string, body: string, o: { when?: number; prevId?: string } = {}) {
    const j = JSON.parse(fs.readFileSync(path.join(tmp, "meta/_journal.json"), "utf8")) as { entries: JournalEntry[] };
    const last = j.entries.at(-1)!;
    const idx = last.idx + 1;
    const lastSnapshot = JSON.parse(fs.readFileSync(path.join(tmp, `meta/${String(last.idx).padStart(4, "0")}_snapshot.json`), "utf8"));
    j.entries.push({ idx, version: "6", when: o.when ?? last.when + 1000, tag, breakpoints: true });
    fs.writeFileSync(path.join(tmp, "meta/_journal.json"), JSON.stringify(j));
    fs.writeFileSync(path.join(tmp, `${tag}.sql`), body);
    fs.writeFileSync(
      path.join(tmp, `meta/${String(idx).padStart(4, "0")}_snapshot.json`),
      JSON.stringify({ ...lastSnapshot, id: `00000000-0000-4000-8000-00000000000${idx}`, prevId: o.prevId ?? lastSnapshot.id }),
    );
  }

  /** The tag the next migration gets, e.g. 0011_<name> once 0010 exists. */
  const nextTag = (name: string) => `${String(journal().entries.length).padStart(4, "0")}_${name}`;

  it("pass every static guard", () => {
    expect(checkMigrations(MIGRATIONS_DIR)).toEqual([]);
  });

  it("allow an additive migration with hand-fixed ON DELETE clauses", () => {
    addMigration(
      nextTag("additive"),
      [
        "CREATE TABLE `forms` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`project_id` text NOT NULL,\n\t`renamed_at` integer,\n\tFOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade\n);\n",
        "\nALTER TABLE `testimonials` ADD `form_id` text REFERENCES forms(id) ON DELETE set null;",
        "\nCREATE UNIQUE INDEX `forms_project_default_idx` ON `forms` (`project_id`) WHERE is_default = 1;",
        "\n-- backfill\nUPDATE `testimonials` SET `form_id` = NULL WHERE `source` = 'form'\n",
      ].join("--> statement-breakpoint"),
    );
    expect(checkMigrations(tmp)).toEqual([]);
  });

  it("catch a table rebuild, a missing ON DELETE, a skewed journal and a trailing breakpoint", () => {
    addMigration(
      nextTag("rebuild"),
      [
        "ALTER TABLE `testimonials` ADD `form_id` text REFERENCES forms(id);",
        "\nCREATE TABLE `__new_tags` (`id` text PRIMARY KEY NOT NULL);",
        "\nINSERT INTO `__new_tags`(`id`) SELECT `id` FROM `tags`;",
        "\nDROP TABLE `tags`;",
        "\nALTER TABLE `__new_tags` RENAME TO `tags`;",
        "\nALTER TABLE `tags` DROP COLUMN `name`;",
        "\nPRAGMA foreign_keys=OFF;",
        "\n",
      ].join("--> statement-breakpoint"),
      { when: journal().entries.at(-1)!.when, prevId: "11111111-1111-4111-8111-111111111111" },
    );
    const problems = checkMigrations(tmp).join("\n");
    for (const expected of [
      /not after \d{4}_\w+'s/,
      /__new_/,
      /DROP TABLE/,
      /DROP COLUMN/,
      /RENAME/,
      /PRAGMA foreign_keys/,
      /REFERENCES without ON DELETE/,
      /ends with a statement breakpoint/,
      /prevId/,
    ]) {
      expect(problems).toMatch(expected);
    }
  });

  it("catch an edited released migration, a stray .sql file and a missing snapshot", () => {
    fs.appendFileSync(path.join(tmp, "0003_consent_ledger.sql"), " ");
    fs.writeFileSync(path.join(tmp, "0009_orphan.sql"), "SELECT 1;");
    fs.rmSync(path.join(tmp, "meta/0004_snapshot.json"));
    const problems = checkMigrations(tmp).join("\n");
    expect(problems).toMatch(/0003_consent_ledger: released migration was edited/);
    expect(problems).toMatch(/0009_orphan\.sql: not in meta\/_journal\.json/);
    expect(problems).toMatch(/0004_requests: meta\/0004_snapshot\.json is missing/);
  });

  it("match src/db/schema.ts (no change without a migration)", () => {
    const result = checkSchemaDrift();
    expect(result.output).toContain("No schema changes");
    expect(result.ok).toBe(true);
  });

  it("report schema drift when schema.ts changes with no migration", () => {
    const root = path.resolve(__dirname, "..");
    const schema = path.join(tmp, "schema.ts");
    fs.writeFileSync(
      schema,
      `export * from ${JSON.stringify(path.join(root, "src/db/schema"))};\n` +
        `import { sqliteTable, text } from ${JSON.stringify(path.join(root, "node_modules/drizzle-orm/sqlite-core"))};\n` +
        `export const drifted = sqliteTable("drifted_things", { id: text("id").primaryKey() });\n`,
    );
    const result = checkSchemaDrift({ schema });
    expect(result.ok).toBe(false);
    expect(result.generated.join("\n")).toContain("CREATE TABLE `drifted_things`");
  });
});

describe("a fresh database", () => {
  let ctx: ReturnType<typeof useTempDataDir>;
  beforeEach(() => {
    ctx = useTempDataDir();
  });
  afterEach(() => ctx.cleanup());

  it("migrates from 0000 to the latest migration", () => {
    const applied = rows<{ created_at: number }>("SELECT created_at FROM __drizzle_migrations ORDER BY created_at");
    expect(applied.map((r) => Number(r.created_at))).toEqual(journal().entries.map((e) => e.when));
    for (const table of OLD_TABLES) expect(tableExists(table), table).toBe(true);
    expect(rows("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(rows("PRAGMA foreign_key_check")).toEqual([]);
  });
});

describe("useMigrationsUpTo", () => {
  let ctx: ReturnType<typeof useTempDataDir>;
  let older: ReturnType<typeof useMigrationsUpTo>;
  beforeEach(() => {
    ctx = useTempDataDir();
  });
  afterEach(() => {
    older.cleanup();
    ctx.cleanup();
  });

  it("stops at the given migration, and upgrade() runs the rest on the same file", () => {
    older = useMigrationsUpTo(7);
    expect(older.pending[0]).toBe("0008_auto_approve");
    const columns = () => rows<{ name: string }>("PRAGMA table_info(projects)").map((c) => c.name);
    expect(columns()).not.toContain("auto_approve");
    getDb().run(sql`INSERT INTO projects (id, slug, name, prompt, thank_you_message) VALUES ('p1', 'old', 'Old', 'Q?', 'Thanks')`);
    older.upgrade();
    expect(columns()).toContain("auto_approve");
    expect(rows("SELECT id, auto_approve FROM projects")).toEqual([{ id: "p1", auto_approve: 0 }]);
    expect(rows("SELECT count(*) AS n FROM __drizzle_migrations")).toEqual([{ n: journal().entries.length }]);
  });
});

/**
 * A database as the 0008 release left it: two projects (one with empty
 * questions and auto-approve on since a date), testimonials in every legacy
 * status plus a withdrawn one, tags, consent versions and events, requests, a
 * webhook with a delivery, an upload, and a row in every other table.
 */
const SEED_0008 = `
INSERT INTO projects (id, slug, name, prompt, thank_you_message, accent_color, allow_video, allow_text, questions, max_video_seconds,
  consent_text, invite_subject, invite_message, reminder_days, thank_you_email, auto_approve, auto_approve_min_rating,
  auto_approve_video, auto_approve_since, created_at) VALUES
 ('p-acme', 'acme', 'Acme', 'How has Acme helped you?', 'Thank you, truly.', '#0f766e', 1, 1, '', 120,
  '', '', '', '3,7', 1, 1, 4, 0, 1792800000000, 1792700000000),
 ('p-beta', 'beta', 'Beta Co', 'What changed for you?', 'Thanks!', '#7c3aed', 1, 0, 'What changed?
Would you recommend us?', 90, 'I agree {project} may quote me.', 'Got a minute, {name}?', '', '', 0, 0, 5, 0, NULL, 1792700001000);

INSERT INTO consent_versions (id, project_id, version, text, hash, created_at) VALUES
 ('cv-acme-1', 'p-acme', 1, 'I agree that Acme may publish this.', 'hash-acme-1', 1792700000000),
 ('cv-beta-1', 'p-beta', 1, 'I agree Beta Co may quote me.', 'hash-beta-1', 1792700001000);

INSERT INTO testimonials (id, project_id, status, rating, text, author_name, author_email, author_title, author_company,
  avatar_key, video_key, video_mime, video_original_key, poster_key, video_duration_ms, video_width, video_height,
  media_status, transcript, captions_vtt, transcript_status, consent_scopes, edited_after_consent, withdrawn_at,
  withdraw_token_hash, request_id, consent_at, source, approved_by, approved_at, approval_rule, created_at, updated_at) VALUES
 ('t-approved', 'p-acme', 'approved', 5, 'Acme made onboarding painless.', 'Ada Approved', 'ada@example.com', 'CTO', 'Lovelace Ltd',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'none', NULL, NULL, 'none', '["website","social"]', 0, NULL,
  'withdraw-hash-1', NULL, 1792750000000, 'form', 'owner', 1792760000000, NULL, 1792750000000, 1792760000000),
 ('t-video', 'p-acme', 'approved', 4, NULL, 'Vic Video', 'vic@example.com', NULL, 'Vic & Co',
  'images/11111111-1111-4111-8111-111111111111.png', 'videos/22222222-2222-4222-8222-222222222222.mp4', 'video/mp4',
  'videos/33333333-3333-4333-8333-333333333333.webm', 'images/44444444-4444-4444-8444-444444444444.jpg', 15000, 1280, 720,
  'ready', 'The search is wonderfully quick.', 'WEBVTT

00:00.000 --> 00:02.000
The search is wonderfully quick.', 'ready', '["website"]', 1, NULL,
  'withdraw-hash-2', NULL, 1792750001000, 'form', 'auto', 1792760001000, '4+ stars', 1792750001000, 1792760001000),
 ('t-pending', 'p-acme', 'pending', 3, 'Pretty good so far.', 'Pat Pending', NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'none', NULL, NULL, 'none', '["website"]', 0, NULL,
  'withdraw-hash-3', NULL, 1792750003000, 'form', NULL, NULL, NULL, 1792750003000, 1792750003000),
 ('t-rejected', 'p-acme', 'rejected', 1, 'Spam spam spam.', 'Rex Rejected', NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'none', NULL, NULL, 'none', '["website"]', 0, NULL,
  NULL, NULL, 1792750004000, 'api', NULL, NULL, NULL, 1792750004000, 1792750004000),
 ('t-withdrawn', 'p-acme', 'approved', 5, 'Please take this down later.', 'Wren Withdrawn', 'wren@example.com', NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'none', NULL, NULL, 'none', '["website"]', 0, 1792770000000,
  'withdraw-hash-5', NULL, 1792750005000, 'form', 'owner', 1792760005000, NULL, 1792750005000, 1792770000000),
 ('t-imported', 'p-acme', 'approved', 4, 'Imported praise for Acme.', 'Ivy Imported', NULL, 'Founder', NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'none', NULL, NULL, 'none', '["website"]', 0, NULL,
  NULL, NULL, 1792750002000, 'import:senja', 'owner', 1792760002000, NULL, 1792750002000, 1792760002000),
 ('t-beta', 'p-beta', 'pending', NULL, 'Beta helped our enterprise rollout.', 'Rae Requested', 'rae@example.com', NULL, 'Raeco',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'none', NULL, NULL, 'none', '["website"]', 0, NULL,
  'withdraw-hash-7', 'rq-beta', 1792750006000, 'form', NULL, NULL, NULL, 1792750006000, 1792750006000);

INSERT INTO tags (id, project_id, name) VALUES
 ('tag-pricing', 'p-acme', 'pricing'), ('tag-support', 'p-acme', 'support'), ('tag-zephyr', 'p-beta', 'zephyr');
INSERT INTO testimonial_tags (testimonial_id, tag_id) VALUES
 ('t-approved', 'tag-pricing'), ('t-video', 'tag-support'), ('t-video', 'tag-pricing'), ('t-beta', 'tag-zephyr');

INSERT INTO consent_events (id, testimonial_id, type, actor, version_id, text, text_hash, scopes, ip_hash, detail, created_at) VALUES
 ('ce-1', 't-approved', 'granted', 'customer', 'cv-acme-1', 'I agree that Acme may publish this.', 'hash-acme-1', '["website","social"]', NULL, NULL, 1792750000000),
 ('ce-2', 't-video', 'granted', 'customer', 'cv-acme-1', 'I agree that Acme may publish this.', 'hash-acme-1', '["website"]', NULL, NULL, 1792750001000),
 ('ce-3', 't-video', 'edited', 'owner', NULL, NULL, NULL, NULL, NULL, 'Text changed', 1792760000000),
 ('ce-4', 't-withdrawn', 'granted', 'customer', 'cv-acme-1', 'I agree that Acme may publish this.', 'hash-acme-1', '["website"]', NULL, NULL, 1792750005000),
 ('ce-5', 't-withdrawn', 'withdrawn', 'customer', NULL, NULL, NULL, NULL, NULL, NULL, 1792770000000),
 ('ce-6', 't-imported', 'imported', 'import', NULL, NULL, NULL, '["website"]', NULL, 'From a CSV file', 1792750002000),
 ('ce-7', 't-beta', 'granted', 'customer', 'cv-beta-1', 'I agree Beta Co may quote me.', 'hash-beta-1', '["website"]', NULL, NULL, 1792750006000);

INSERT INTO requests (id, project_id, name, email, company, status, email_status, email_error, sent_at, reminders_sent,
  next_reminder_at, responded_at, testimonial_id, unsubscribed_at, created_at) VALUES
 ('rq-beta', 'p-beta', 'Rae', 'rae@example.com', 'Raeco', 'responded', 'sent', NULL, 1792740000000, 1, NULL, 1792750006000, 't-beta', NULL, 1792740000000),
 ('rq-acme', 'p-acme', NULL, 'sam@example.com', NULL, 'waiting', 'sent', NULL, 1792740000000, 0, 1792999999999, NULL, NULL, NULL, 1792740000000),
 ('rq-gone', 'p-acme', 'Una', 'una@example.com', NULL, 'unsubscribed', 'failed', 'Mailbox full', NULL, 0, NULL, NULL, NULL, 1792741000000, 1792740000000);

INSERT INTO api_keys (id, name, prefix, key_hash, scope, created_at, last_used_at, revoked_at) VALUES
 ('key-1', 'Zapier', 'pl_ab12', 'key-hash-1', 'write', 1792700000000, NULL, NULL);
INSERT INTO webhooks (id, url, secret, events, project_id, active, created_at) VALUES
 ('wh-acme', 'https://hooks.example.com/plaudit', 'whsec-1', '["testimonial.created","testimonial.approved"]', 'p-acme', 1, 1792700000000),
 ('wh-all', 'https://hooks.example.com/all', 'whsec-2', '[]', NULL, 1, 1792700000000);
INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, attempts, response_status, response_body, error, duration_ms, created_at, delivered_at) VALUES
 ('del-1', 'wh-acme', 'testimonial.created', '{"id":"t-approved"}', 'success', 1, 200, 'ok', NULL, 42, 1792750000000, 1792750000100),
 ('del-2', 'wh-all', 'testimonial.approved', '{"id":"t-video"}', 'failed', 3, 500, NULL, 'Server error', 1000, 1792760001000, NULL);
INSERT INTO jobs (id, type, payload, status, attempts, max_attempts, run_at, locked_until, last_error, created_at, updated_at) VALUES
 ('job-1', 'webhooks.deliver', '{"deliveryId":"del-1"}', 'done', 1, 5, 1792750000000, NULL, NULL, 1792750000000, 1792750000100);
INSERT INTO uploads (id, kind, project_id, token_hash, received, max_bytes, created_at, expires_at) VALUES
 ('up-1', 'video', 'p-acme', 'upload-token-hash', 2048, 209715200, 1792750000000, 1792836400000);
INSERT INTO members (id, email, name, role, invited_by, created_at, activated_at, last_sign_in_at) VALUES
 ('mem-1', 'teammate@team.example', 'Tea Mate', 'admin', 'owner@example.com', 1792700000000, 1792700100000, 1792750000000);
INSERT INTO login_tokens (id, token_hash, email, purpose, browser_hash, created_at, expires_at, used_at) VALUES
 ('lt-1', 'login-token-hash', 'teammate@team.example', 'sign-in', 'browser-hash', 1792750000000, 1792750900000, NULL);
INSERT INTO oauth_flows (id, provider, state, nonce, code_verifier, code, user_json, created_at, expires_at) VALUES
 ('of-1', 'google', 'state-1', 'nonce-1', 'verifier-1', NULL, NULL, 1792750000000, 1792750600000);
`;

/**
 * What /api/widget/acme served for SEED_0008 at release 0008: approved and not
 * withdrawn, newest first, with the exact public shape (D18 keeps it frozen).
 */
const ACME_FEED_0008 = {
  project: { name: "Acme", slug: "acme", accentColor: "#0f766e" },
  testimonials: [
    {
      id: "t-imported",
      name: "Ivy Imported",
      title: "Founder",
      company: null,
      avatarUrl: null,
      rating: 4,
      text: "Imported praise for Acme.",
      video: null,
      tags: [],
      createdAt: "2026-10-23T10:06:42.000Z",
    },
    {
      id: "t-video",
      name: "Vic Video",
      title: null,
      company: "Vic & Co",
      avatarUrl: "/api/media/images/11111111-1111-4111-8111-111111111111.png",
      rating: 4,
      text: null,
      video: {
        url: "/api/media/videos/22222222-2222-4222-8222-222222222222.mp4",
        mime: "video/mp4",
        poster: "/api/media/images/44444444-4444-4444-8444-444444444444.jpg",
        width: 1280,
        height: 720,
        durationMs: 15000,
        sources: [
          { url: "/api/media/videos/22222222-2222-4222-8222-222222222222.mp4", type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
          { url: "/api/media/videos/33333333-3333-4333-8333-333333333333.webm", type: "video/webm" },
        ],
        captionsUrl: "/api/captions/t-video",
        transcript: "The search is wonderfully quick.",
      },
      tags: ["pricing", "support"],
      createdAt: "2026-10-23T10:06:41.000Z",
    },
    {
      id: "t-approved",
      name: "Ada Approved",
      title: "CTO",
      company: "Lovelace Ltd",
      avatarUrl: null,
      rating: 5,
      text: "Acme made onboarding painless.",
      video: null,
      tags: ["pricing"],
      createdAt: "2026-10-23T10:06:40.000Z",
    },
  ],
};

describe("upgrading a 0008 database", () => {
  let ctx: ReturnType<typeof useTempDataDir>;
  let older: ReturnType<typeof useMigrationsUpTo>;
  let countsBefore: Record<string, number>;

  const count = (table: string) => (getDb().get<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM ${table}`)) ?? { n: 0 }).n;
  const feed = async () => (await widgetFeed(new Request("http://localhost/api/widget/acme"), params({ slug: "acme" }))).json();

  beforeAll(() => {
    ctx = useTempDataDir();
    older = useMigrationsUpTo(8);
    getDb(); // creates the 0008 schema
    const raw = new Database(env.databasePath);
    raw.pragma("foreign_keys = ON");
    raw.transaction(() => raw.exec(SEED_0008))();
    raw.close();
    countsBefore = Object.fromEntries(OLD_TABLES.map((t) => [t, count(t)]));
    older.upgrade();
    getDb(); // runs every migration after 0008
  });
  afterAll(() => {
    older.cleanup();
    ctx.cleanup();
  });

  it("applies every remaining migration", () => {
    const applied = rows<{ created_at: number }>("SELECT created_at FROM __drizzle_migrations ORDER BY created_at");
    expect(applied.map((r) => Number(r.created_at))).toEqual(journal().entries.map((e) => e.when));
  });

  it("keeps the row count of all 15 old tables", () => {
    expect(Object.values(countsBefore).every((n) => n > 0)).toBe(true);
    expect(Object.fromEntries(OLD_TABLES.map((t) => [t, count(t)]))).toEqual(countsBefore);
  });

  it("leaves no broken foreign keys and an intact file", () => {
    expect(rows("PRAGMA foreign_key_check")).toEqual([]);
    expect(rows("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });

  it("serves the same public feed as before", async () => {
    expect(await feed()).toEqual(ACME_FEED_0008);
    expect(listPublicTestimonials("p-acme")).toEqual(ACME_FEED_0008.testimonials);
  });

  // Phase 1 schema (docs/v1-implementation-plan.md §2.3). These run as soon as
  // migrations 0009 and 0010 exist, and skip until then.
  const NO_FORMS = "forms arrive with migration 0009 (WP1.1)";
  const defaultForms = () =>
    Object.fromEntries(rows<{ project_id: string; id: string }>("SELECT project_id, id FROM forms WHERE is_default = 1").map((f) => [f.project_id, f.id]));

  it("creates one classic default form per project (0009)", ({ skip }) => {
    skip(!tableExists("forms"), NO_FORMS);
    expect(rows("SELECT project_id, slug, status, layout, is_default, config_version FROM forms ORDER BY project_id")).toEqual([
      { project_id: "p-acme", slug: "default", status: "live", layout: "classic", is_default: 1, config_version: 0 },
      { project_id: "p-beta", slug: "default", status: "live", layout: "classic", is_default: 1, config_version: 0 },
    ]);
  });

  it("links form submissions and every request to the default form (0009)", ({ skip }) => {
    skip(!tableExists("forms"), NO_FORMS);
    const forms = defaultForms();
    for (const t of rows<{ id: string; project_id: string; source: string; form_id: string | null }>("SELECT id, project_id, source, form_id FROM testimonials")) {
      expect(t.form_id, t.id).toBe(t.source === "form" ? forms[t.project_id] : null);
    }
    for (const r of rows<{ id: string; project_id: string; form_id: string | null }>("SELECT id, project_id, form_id FROM requests")) {
      expect(r.form_id, r.id).toBe(forms[r.project_id]);
    }
  });

  it("keeps ON DELETE on the four hand-fixed foreign keys (0009)", ({ skip }) => {
    skip(!tableExists("forms"), NO_FORMS);
    const onDelete = (table: string, column: string) =>
      rows<{ from: string; table: string; on_delete: string }>(`PRAGMA foreign_key_list(${table})`)
        .filter((f) => f.from === column)
        .map((f) => `${f.table} ${f.on_delete.toUpperCase()}`);
    expect(onDelete("testimonials", "form_id")).toEqual(["forms SET NULL"]);
    expect(onDelete("testimonials", "customer_id")).toEqual(["customers SET NULL"]);
    expect(onDelete("requests", "form_id")).toEqual(["forms SET NULL"]);
    expect(onDelete("webhooks", "form_id")).toEqual(["forms CASCADE"]);
  });

  it("fills the search index, including tag names (0010)", ({ skip }) => {
    skip(!tableExists("testimonials_fts"), "the search index arrives with migration 0010 (WP1.1)");
    const search = (word: string) =>
      rows<{ testimonial_id: string }>(
        `SELECT s.testimonial_id FROM testimonials_fts JOIN testimonial_search s ON s.id = testimonials_fts.rowid
         WHERE testimonials_fts MATCH '${word}' ORDER BY s.testimonial_id`,
      ).map((r) => r.testimonial_id);
    expect(count("testimonial_search")).toBe(countsBefore.testimonials);
    expect(search("painless")).toEqual(["t-approved"]);
    expect(search("wonderfully")).toEqual(["t-video"]);
    expect(search("pricing")).toEqual(["t-approved", "t-video"]);
    expect(search("zephyr")).toEqual(["t-beta"]);
  });

  it("hydrates each default form to formConfigFromProject, with DEFAULT_QUESTIONS for empty questions (WP1.2)", ({ skip }) => {
    skip(!tableExists("forms"), NO_FORMS);
    const projectsBefore = rows("SELECT * FROM projects ORDER BY id");
    for (const id of ["p-acme", "p-beta"]) {
      const form = getDefaultForm(id);
      expect(form.id).toBe(defaultForms()[id]);
      expect(form).toMatchObject({ layout: "classic", configVersion: 1 });
      expect(parseFormRow(form)).toEqual(formConfigFromProject(getProjectById(id)!));
    }
    const acme = parseFormRow(getDefaultForm("p-acme"));
    expect(primaryQuestion(acme)?.tips).toEqual(DEFAULT_QUESTIONS);
    expect(acme.settings.autoApprove).toEqual({ mode: "rating", minRating: 4, includeVideo: false, since: new Date(1792800000000) });
    expect(primaryQuestion(parseFormRow(getDefaultForm("p-beta")))).toMatchObject({ mode: "video", tips: ["What changed?", "Would you recommend us?"] });
    // Filling the forms in never touches the project columns they came from.
    expect(rows("SELECT * FROM projects ORDER BY id")).toEqual(projectsBefore);
  });

  // Last: it changes the database the tests above read.
  it("lets a form be deleted, nulling form_id with no foreign key error (0009)", ({ skip }) => {
    skip(!tableExists("forms"), NO_FORMS);
    getDb().run(sql`DELETE FROM forms WHERE id = ${defaultForms()["p-acme"]}`);
    expect(rows("SELECT id FROM testimonials WHERE project_id = 'p-acme' AND form_id IS NOT NULL")).toEqual([]);
    expect(rows("SELECT id FROM requests WHERE project_id = 'p-acme' AND form_id IS NOT NULL")).toEqual([]);
    expect(count("testimonials")).toBe(countsBefore.testimonials);
    expect(rows("PRAGMA foreign_key_check")).toEqual([]);
  });
});
