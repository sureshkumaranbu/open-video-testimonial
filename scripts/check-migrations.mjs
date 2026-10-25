/**
 * Static guards for drizzle/ (run by `npm run db:check` and tests/migrations.test.ts).
 *
 * The migrator runs every pending file inside one BEGIN with foreign_keys=ON,
 * so a drizzle table rebuild (__new_x, INSERT SELECT, DROP, RENAME) cascades
 * its DROP into consent_events, testimonial_tags and other child rows. It also
 * applies a migration only when its journal `when` is newer than the last one
 * applied, and never checks the hash, so a skewed `when` or an edited file
 * silently diverges existing databases while fresh ones (and tests) pass.
 *
 *   node scripts/check-migrations.mjs [--dir drizzle]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BREAKPOINT = "--> statement-breakpoint";

/** Journal entries from this idx on are Phase 1 work and must be additive only. */
export const ADDITIVE_FROM = 9;

/**
 * Migrations already released. Their journal `when` and file hash must never
 * change (CONTRIBUTING.md). Add an entry once a migration is merged to main.
 */
export const RELEASED = {
  "0000_init": { when: 1792617844658, sha256: "1f95d30c2b2ad9da21c3bc7d0f49904702019321e9117532f91afd6f162319db" },
  "0001_media_pipeline": { when: 1792684309433, sha256: "8bceb502697c1860d5ba141cb1b9d878bc5b24f948fbf9c56d13e9363acfba2a" },
  "0002_transcripts": { when: 1792685339546, sha256: "4522c701898e55276ea5613c644bcca636a435efc9f64e48ec7ee9cb92dc6ae8" },
  "0003_consent_ledger": { when: 1792685684957, sha256: "1968806bf717390984c0a8b6919a136042c5adafbf0065bcf622bc849a8cb34c" },
  "0004_requests": { when: 1792686104748, sha256: "b074f6969efaf7ebec3f5d5f7e3c27ea6d54617d55ef35af0ac58685b8f09d7d" },
  "0005_api_webhooks": { when: 1792686601627, sha256: "ebb40b48e38d47d4a1c483b256a10d4c4bf06359ef0abb7d6efa91f357b1c45b" },
  "0006_media_key_indexes": { when: 1792741263470, sha256: "a9c65af41ac63c418e11cb29712183a8698e0330153e694ca55d4dd69e9aabf6" },
  "0007_sign_in": { when: 1792767534509, sha256: "4dad53ad541f8dddf1edc387442f3c6e428e90423f5eb9f05c277791c9944158" },
  "0008_auto_approve": { when: 1792854757042, sha256: "0100fb44f5c1a7241db9516c54fdb341080d427bdf8d9d65510ef4425c39e100" },
};

/** SQL that rebuilds or removes tables and columns, or switches FK checks (which does nothing inside BEGIN). */
const FORBIDDEN = [
  { re: /__new_/i, why: "a drizzle table rebuild (__new_*)" },
  { re: /\bDROP\s+TABLE\b/i, why: "DROP TABLE" },
  { re: /\bDROP\s+COLUMN\b/i, why: "DROP COLUMN" },
  { re: /\bRENAME\b/i, why: "RENAME" },
  { re: /\bPRAGMA\s+foreign_keys\b/i, why: "PRAGMA foreign_keys" },
];

const ZERO_ID = "00000000-0000-0000-0000-000000000000";

/** A chunk with nothing but whitespace and `--` comments makes better-sqlite3's prepare() throw. */
function isEmptyChunk(chunk) {
  return chunk.replace(/--[^\n]*/g, "").trim() === "";
}

function readJson(file, problems) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    problems.push(`${file}: can't read it (${e instanceof Error ? e.message : e})`);
    return null;
  }
}

/** Every problem found in a migrations folder; empty means it's safe to ship. */
export function checkMigrations(dir = "drizzle") {
  const problems = [];
  const journal = readJson(path.join(dir, "meta", "_journal.json"), problems);
  if (!journal) return problems;
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  if (entries.length === 0) problems.push("meta/_journal.json has no entries");

  let prevSnapshotId = ZERO_ID;
  const snapshotIds = new Set();
  entries.forEach((entry, i) => {
    const label = entry.tag ?? `entry ${i}`;
    if (entry.idx !== i) problems.push(`${label}: journal idx is ${entry.idx}, expected ${i} (idx must be contiguous)`);
    if (i > 0 && !(entry.when > entries[i - 1].when)) {
      problems.push(`${label}: journal "when" ${entry.when} is not after ${entries[i - 1].tag}'s ${entries[i - 1].when}, so existing databases would skip it`);
    }
    if (typeof entry.tag !== "string" || !entry.tag.startsWith(String(i).padStart(4, "0") + "_")) {
      problems.push(`${label}: tag should start with ${String(i).padStart(4, "0")}_`);
    }

    const released = RELEASED[entry.tag];
    if (released && released.when !== entry.when) {
      problems.push(`${label}: released migration's "when" changed from ${released.when} to ${entry.when}`);
    }

    const sqlFile = path.join(dir, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlFile)) {
      problems.push(`${label}: ${entry.tag}.sql is missing`);
    } else {
      const sql = fs.readFileSync(sqlFile, "utf8");
      if (released) {
        const hash = crypto.createHash("sha256").update(sql).digest("hex");
        if (hash !== released.sha256) problems.push(`${label}: released migration was edited (never edit one that's merged; add a new one)`);
      }
      const chunks = sql.split(BREAKPOINT);
      chunks.forEach((chunk, n) => {
        if (!isEmptyChunk(chunk)) return;
        problems.push(
          n === chunks.length - 1 && n > 0
            ? `${label}: ends with a statement breakpoint (the empty last chunk makes the migrator throw)`
            : `${label}: statement chunk ${n + 1} is empty`,
        );
      });
      if (entry.idx >= ADDITIVE_FROM) {
        for (const { re, why } of FORBIDDEN) {
          if (re.test(sql)) problems.push(`${label}: contains ${why}; Phase 1 migrations may only add tables, columns and indexes`);
        }
        for (const chunk of chunks) {
          const statement = chunk.replace(/--[^\n]*/g, " ");
          if (/^\s*ALTER\s+TABLE\b[\s\S]*\bADD\b[\s\S]*\bREFERENCES\b/i.test(statement) && !/\bON\s+DELETE\b/i.test(statement)) {
            const first = statement.trim().split("\n")[0].slice(0, 120);
            problems.push(`${label}: ALTER TABLE … REFERENCES without ON DELETE (drizzle-kit drops it; add it by hand): ${first}`);
          }
        }
      }
    }

    const snapshotFile = path.join(dir, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`);
    if (!fs.existsSync(snapshotFile)) {
      problems.push(`${label}: meta/${path.basename(snapshotFile)} is missing`);
      prevSnapshotId = null;
      return;
    }
    const snapshot = readJson(snapshotFile, problems);
    if (!snapshot) return;
    if (prevSnapshotId !== null && snapshot.prevId !== prevSnapshotId) {
      problems.push(`${label}: snapshot prevId ${snapshot.prevId} doesn't match the previous snapshot's id ${prevSnapshotId}`);
    }
    if (snapshotIds.has(snapshot.id)) problems.push(`${label}: snapshot id ${snapshot.id} is used twice`);
    snapshotIds.add(snapshot.id);
    prevSnapshotId = snapshot.id;
  });

  const tags = new Set(entries.map((e) => e.tag));
  for (const tag of Object.keys(RELEASED)) {
    if (!tags.has(tag)) problems.push(`${tag}: released migration is missing from meta/_journal.json`);
  }
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".sql") && !tags.has(file.slice(0, -4))) {
      problems.push(`${file}: not in meta/_journal.json (the migrator would never run it)`);
    }
  }
  const metaDir = path.join(dir, "meta");
  for (const file of fs.existsSync(metaDir) ? fs.readdirSync(metaDir) : []) {
    const m = /^(\d{4})_snapshot\.json$/.exec(file);
    if (m && Number(m[1]) >= entries.length) problems.push(`meta/${file}: no journal entry for it`);
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--dir");
  const dir = at >= 0 ? args[at + 1] : "drizzle";
  const problems = checkMigrations(dir);
  if (problems.length) {
    console.error(`Migration check failed (${dir}):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  const { entries } = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"));
  console.log(`Migrations OK: ${entries.length} in ${dir}, last ${entries.at(-1).tag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
