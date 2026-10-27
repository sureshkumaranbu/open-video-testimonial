/**
 * Fails when a requirement ID gated for a milestone (docs/plan/ownership.json
 * → milestones) has no test whose title contains it. Titles come from
 * it/test/describe calls in tests/**\/*.test.ts and e2e/**\/*.spec.ts; skipped
 * and todo tests don't count. New e2e titles start with their ID
 * (`test("FORM-07 hidden fields …")`), so `--grep FORM-07` finds them too.
 *
 *   node scripts/req-coverage.mjs --milestone M2 | --all [--report]
 *
 * --report prints the table and always exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CALL =
  /\b(?:it|test|describe|suite)((?:\.(?:only|skip|todo|fixme|fails|concurrent|sequential|serial|parallel|describe|skipIf\([^)]*\)|runIf\([^)]*\)|each\([^)]*\)|for\([^)]*\)))*)\s*\(\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;

/** Every test title in `source`, with its line, minus skipped and todo ones. */
export function testTitles(source) {
  const titles = [];
  for (const m of source.matchAll(CALL)) {
    if (/\.(?:skip|todo|fixme)\b/.test(m[1])) continue;
    titles.push({ title: m[3], line: source.slice(0, m.index).split("\n").length });
  }
  return titles;
}

function walk(dir, suffix, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory() && d.name !== "node_modules") walk(p, suffix, out);
    else if (d.isFile() && d.name.endsWith(suffix)) out.push(p);
  }
  return out;
}

export function collectTitles(root = ROOT) {
  const files = [...walk(path.join(root, "tests"), ".test.ts"), ...walk(path.join(root, "e2e"), ".spec.ts")];
  return files.flatMap((file) =>
    testTitles(fs.readFileSync(file, "utf8")).map((t) => ({ ...t, file: path.relative(root, file) })),
  );
}

const hasId = (title, id) => new RegExp(`(^|[^A-Z0-9-])${id}(?![0-9])`).test(title);

/** Requirement → the tests that mention it (empty list = not covered). */
export function coverage(ids, titles) {
  return Object.fromEntries(ids.map((id) => [id, titles.filter((t) => hasId(t.title, id))]));
}

export function requirementsFor(manifest, milestone) {
  if (milestone === "all") return [...new Set(Object.values(manifest.milestones).flatMap((m) => m.requirements ?? []))];
  const m = manifest.milestones[milestone];
  if (!m) throw new Error(`Unknown milestone "${milestone}"; expected one of ${Object.keys(manifest.milestones).join(", ")}`);
  return m.requirements ?? [];
}

function main() {
  const args = process.argv.slice(2);
  const milestone = args.includes("--all") ? "all" : args[args.indexOf("--milestone") + 1];
  if (!milestone || (!args.includes("--all") && !args.includes("--milestone"))) {
    console.error("Usage: node scripts/req-coverage.mjs --milestone <M1..M7, M9..M12> | --all [--report]");
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "plan", "ownership.json"), "utf8"));
  const ids = requirementsFor(manifest, milestone);
  const result = coverage(ids, collectTitles());
  const missing = ids.filter((id) => result[id].length === 0);
  for (const id of ids) {
    const hits = result[id];
    console.log(hits.length ? `  ok       ${id}  ${hits.length} test(s), e.g. ${hits[0].file}:${hits[0].line}` : `  MISSING  ${id}`);
  }
  const label = milestone === "all" ? "All milestones" : milestone;
  if (missing.length && !args.includes("--report")) {
    console.error(`\n${label}: ${missing.length} of ${ids.length} requirements have no test title naming them: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${label}: ${ids.length - missing.length} of ${ids.length} requirements covered by a test title.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
