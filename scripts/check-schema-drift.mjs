/**
 * Fails when src/db/schema.ts no longer matches the latest migration snapshot,
 * i.e. the schema changed without `npm run db:generate`. drizzle-kit runs
 * against a copy of drizzle/ in the temp directory, so the repo is never
 * touched. Its `out` must be relative: drizzle-kit prefixes "./" to it.
 *
 * Custom SQL (the inbox search view, FTS table and triggers) isn't in the
 * snapshot and generate never diffs it, so it causes no drift. Never run
 * `drizzle-kit push`: it would drop those objects.
 *
 *   node scripts/check-schema-drift.mjs [--schema ./src/db/schema.ts] [--dir drizzle]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const relative = (from, to) => {
  const rel = path.relative(from, to);
  return rel.startsWith(".") ? rel : `./${rel}`;
};

const listFiles = (dir) =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)))
    .sort();

/**
 * Runs drizzle-kit generate on a throwaway copy of the migrations. `ok` is
 * true only when it reports no changes and writes no files; `generated` holds
 * the SQL it would have added otherwise.
 */
export function checkSchemaDrift({ schema = "./src/db/schema.ts", dir = "drizzle", cwd = ROOT } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plaudit-drift-"));
  try {
    const out = path.join(tmp, "drizzle");
    fs.cpSync(path.resolve(cwd, dir), out, { recursive: true });
    const before = listFiles(out);
    const run = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "node_modules", "drizzle-kit", "bin.cjs"),
        "generate",
        "--dialect=sqlite",
        `--schema=${relative(cwd, path.resolve(cwd, schema))}`,
        `--out=${relative(cwd, out)}`,
      ],
      // No stdin: a rename prompt fails instead of waiting forever.
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
    );
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const added = listFiles(out).filter((f) => !before.includes(f));
    const generated = added.filter((f) => f.endsWith(".sql")).map((f) => fs.readFileSync(path.join(out, f), "utf8"));
    const ok = run.status === 0 && added.length === 0 && /No schema changes/.test(output);
    return { ok, output: run.error ? `${output}\n${run.error.message}` : output, generated };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const result = checkSchemaDrift({ schema: opt("--schema", undefined), dir: opt("--dir", undefined) });
  if (!result.ok) {
    console.error(
      result.generated.length
        ? `Schema drift: src/db/schema.ts has changes that no migration covers. Run \`npm run db:generate -- --name <name>\`.\n\n${result.generated.join("\n")}`
        : `Schema drift check failed:\n${result.output}`,
    );
    process.exit(1);
  }
  console.log("No schema drift: schema.ts matches the latest migration snapshot.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
