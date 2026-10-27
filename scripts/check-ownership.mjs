/**
 * Keeps parallel work packages out of each other's files (plan §4.1).
 * docs/plan/ownership.json maps each package to the paths it may change; this
 * fails when a package branch (wp/<id>) changes anything else, and when two
 * packages that run at the same time claim the same file. A package may read
 * anything.
 *
 *   node scripts/check-ownership.mjs [--package <id>] [--base <ref>] [--head <ref>]
 *
 * The package comes from --package, WP_PACKAGE, or the branch name (wp/<id>,
 * also GITHUB_HEAD_REF in CI). Off a package branch only the manifest is checked.
 *
 * Globs: `*` stays within a path segment, `**` spans segments, `{a,b}` is a
 * choice, and `[...]` is literal (Next.js route folders). A leading `!` excludes.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST = path.join(ROOT, "docs", "plan", "ownership.json");

/** "a/{b,c/d}.ts" → ["a/b.ts", "a/c/d.ts"]. Braces may nest. */
export function expandBraces(glob) {
  const open = glob.indexOf("{");
  if (open < 0) return [glob];
  let depth = 0;
  const cuts = [];
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}" && --depth === 0) {
      const parts = [];
      let start = open + 1;
      for (const cut of cuts) {
        parts.push(glob.slice(start, cut));
        start = cut + 1;
      }
      parts.push(glob.slice(start, i));
      const head = glob.slice(0, open);
      const tail = glob.slice(i + 1);
      return parts.flatMap((p) => expandBraces(head + p + tail));
    } else if (glob[i] === "," && depth === 1) cuts.push(i);
  }
  throw new Error(`Unbalanced braces in ${glob}`);
}

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slashAfter = glob[i + 2] === "/";
      re += slashAfter ? "(?:.*/)?" : ".*";
      i += slashAfter ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const isLiteral = (glob) => !/[*?]/.test(glob);

/** Compiles a list of globs (with `!` exclusions) into a path predicate. */
export function matcher(globs = []) {
  const include = [];
  const exclude = [];
  for (const g of globs) {
    const neg = g.startsWith("!");
    for (const e of expandBraces(neg ? g.slice(1) : g)) (neg ? exclude : include).push(globToRegExp(e));
  }
  return (file) => include.some((r) => r.test(file)) && !exclude.some((r) => r.test(file));
}

export function loadManifest(file = MANIFEST) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Everything a package may change: what it owns, the stubs it creates, and shared files (docs). */
export function packageMatcher(pkg) {
  return matcher([...(pkg.owns ?? []), ...(pkg.stubs ?? []), ...(pkg.shared ?? [])]);
}

/** Files in `files` that package `id` may not change. */
export function unownedFiles(manifest, id, files) {
  const pkg = manifest.packages[id];
  if (!pkg) throw new Error(`Unknown package "${id}" (see docs/plan/ownership.json)`);
  const allowed = packageMatcher(pkg);
  return files.filter((f) => !allowed(f));
}

/** Who owns a path (stubs and shared files aside). */
export function ownersOf(manifest, file) {
  return Object.entries(manifest.packages)
    .filter(([, pkg]) => matcher(pkg.owns)(file))
    .map(([id]) => id);
}

/**
 * Problems with the manifest itself. `files` are paths to test overlaps on
 * (the tracked files); every literal path named in the manifest is added.
 */
export function validateManifest(manifest, files = []) {
  const problems = [];
  const packages = manifest.packages ?? {};
  const ids = Object.keys(packages);
  if (ids.length === 0) problems.push("no packages");

  const literals = new Set(files);
  for (const [id, pkg] of Object.entries(packages)) {
    if (!pkg.name) problems.push(`${id}: needs a name`);
    if (!(pkg.owns?.length || pkg.shared?.length)) problems.push(`${id}: owns nothing`);
    for (const key of ["owns", "stubs", "shared"]) {
      if (pkg[key] !== undefined && !Array.isArray(pkg[key])) problems.push(`${id}: "${key}" must be a list`);
      for (const g of pkg[key] ?? []) {
        try {
          for (const e of expandBraces(g.replace(/^!/, ""))) if (isLiteral(e) && !g.startsWith("!")) literals.add(e);
        } catch (e) {
          problems.push(`${id}: ${e.message}`);
        }
      }
    }
  }

  const inMilestone = new Map();
  for (const [m, def] of Object.entries(manifest.milestones ?? {})) {
    for (const id of def.packages ?? []) {
      if (!packages[id]) problems.push(`${m}: unknown package ${id}`);
      if (inMilestone.has(id)) problems.push(`${id}: listed in both ${inMilestone.get(id)} and ${m}`);
      inMilestone.set(id, m);
    }
    for (const r of def.requirements ?? []) {
      if (!/^[A-Z]+-\d{2}$/.test(r)) problems.push(`${m}: "${r}" doesn't look like a requirement ID`);
    }
  }
  for (const id of ids) if (!inMilestone.has(id)) problems.push(`${id}: not in any milestone`);

  const owns = Object.fromEntries(ids.map((id) => [id, matcher(packages[id].owns)]));
  for (const group of manifest.concurrent ?? []) {
    for (const id of group.packages) if (!packages[id]) problems.push(`${group.name}: unknown package ${id}`);
    const members = group.packages.filter((id) => packages[id]);
    for (const file of [...literals].sort()) {
      const claim = members.filter((id) => owns[id](file));
      if (claim.length > 1) problems.push(`${file}: owned by ${claim.join(" and ")}, which run at the same time (${group.name})`);
    }
  }
  return problems;
}

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function currentPackage(manifest, explicit) {
  const id = explicit || process.env.WP_PACKAGE;
  if (id) return id;
  let branch = process.env.GITHUB_HEAD_REF || "";
  if (!branch) {
    try {
      branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      return null;
    }
  }
  const m = /^wp\/(.+)$/.exec(branch);
  if (!m) return null;
  if (!manifest.packages[m[1]]) throw new Error(`Branch ${branch} is for package "${m[1]}", which docs/plan/ownership.json doesn't list`);
  return m[1];
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const manifest = loadManifest();
  const problems = validateManifest(manifest, git(["ls-files"]).split("\n").filter(Boolean));
  if (problems.length) {
    console.error(`docs/plan/ownership.json has problems:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }

  const id = currentPackage(manifest, opt("--package"));
  if (!id) {
    console.log("Ownership manifest OK. Not on a wp/<id> branch, so there's no diff to check.");
    return;
  }
  const base = opt("--base") || process.env.OWNERSHIP_BASE || manifest.base;
  const head = opt("--head") || "HEAD";
  let files;
  try {
    files = git(["diff", "--name-only", "--no-renames", `${base}...${head}`]).split("\n").filter(Boolean);
  } catch (e) {
    console.error(`Can't diff ${base}...${head}: ${e.stderr || e.message}\nFetch the base branch, or pass --base <ref>.`);
    process.exit(1);
  }
  const bad = unownedFiles(manifest, id, files);
  if (bad.length) {
    const frozen = matcher(manifest.frozen?.files ?? []);
    const shared = matcher(Object.values(manifest.packages).flatMap((p) => p.shared ?? []));
    console.error(
      `Package ${id} (${manifest.packages[id].name}) changes files it doesn't own:\n` +
        bad
          .map((f) => {
            const owners = ownersOf(manifest, f);
            const note = frozen(f)
              ? "frozen: needs a contract amendment on the base"
              : owners.length
                ? `owned by ${owners.join(", ")}`
                : shared(f)
                  ? "integrator docs: put a doc note in the PR instead"
                  : "owned by no package";
            return `  - ${f} (${note})`;
          })
          .join("\n"),
    );
    process.exit(1);
  }
  console.log(`Package ${id}: all ${files.length} changed files are its own (${base}...${head}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
