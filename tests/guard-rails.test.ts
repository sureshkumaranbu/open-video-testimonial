import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandBraces,
  globToRegExp,
  loadManifest,
  matcher,
  ownersOf,
  unownedFiles,
  validateManifest,
  type Manifest,
} from "../scripts/check-ownership.mjs";
import { coverage, requirementsFor, testTitles } from "../scripts/req-coverage.mjs";

/** The process scripts from WP1.0: who may change what, and which requirements have tests. */

const ROOT = path.resolve(__dirname, "..");
const manifest = loadManifest();
const tracked = () => execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const clone = (): Manifest => JSON.parse(JSON.stringify(manifest));

describe("ownership globs", () => {
  it("expand choices, including nested ones and ones with folders", () => {
    expect(expandBraces("src/lib/{a,b}.ts")).toEqual(["src/lib/a.ts", "src/lib/b.ts"]);
    expect(expandBraces("x/{route,trash/route}.ts")).toEqual(["x/route.ts", "x/trash/route.ts"]);
    expect(expandBraces("{a,b{1,2}}/c")).toEqual(["a/c", "b1/c", "b2/c"]);
    expect(() => expandBraces("src/{a,b")).toThrow(/Unbalanced/);
  });

  it("keep * within a folder, let ** cross folders, and read [..] literally", () => {
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/x/a.ts")).toBe(false);
    expect(globToRegExp("src/**").test("src/x/y/a.ts")).toBe(true);
    expect(globToRegExp("a/**/b.ts").test("a/b.ts")).toBe(true);
    expect(globToRegExp("a/**/b.ts").test("a/x/y/b.ts")).toBe(true);
    expect(globToRegExp("src/app/[id]/page.tsx").test("src/app/[id]/page.tsx")).toBe(true);
    expect(globToRegExp("src/app/[id]/page.tsx").test("src/app/i/page.tsx")).toBe(false);
    expect(globToRegExp("src/app/api/media/[...key]/route.ts").test("src/app/api/media/[...key]/route.ts")).toBe(true);
  });

  it("honour ! exclusions", () => {
    const owns = matcher(["forms/**", "!forms/[formId]/NotifySection.tsx"]);
    expect(owns("forms/[formId]/page.tsx")).toBe(true);
    expect(owns("forms/[formId]/NotifySection.tsx")).toBe(false);
  });
});

describe("docs/plan/ownership.json", () => {
  it("lists every Phase 1 work package from plan §4, each in one milestone", () => {
    const range = (m: number, n: number) => Array.from({ length: n }, (_, i) => `${m}.${i + 1}`);
    expect(Object.keys(manifest.packages).sort()).toEqual(
      [
        "1.0", ...range(1, 7), "1.Z",
        ...range(2, 6), "2.Z",
        ...range(3, 4), "3.Z",
        ...range(4, 3), "4.Z",
        ...range(5, 2), "5.Z",
        ...range(6, 12), "6.Z",
        ...range(7, 4),
      ].sort(),
    );
    // Phase 2 milestones (M9 on) gate requirement IDs only; they have no work packages.
    expect(Object.keys(manifest.milestones)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M9"]);
  });

  it("is consistent, with no file owned by two packages that run at the same time", () => {
    expect(validateManifest(manifest, tracked())).toEqual([]);
  });

  it("spots an overlap, an unknown package and a package outside every milestone", () => {
    const bad = clone();
    bad.packages["1.7"].owns!.push("src/lib/consent.ts");
    bad.concurrent[0].packages.push("9.9");
    bad.packages["8.1"] = { name: "Stray", owns: ["x.ts"] };
    const problems = validateManifest(bad, []).join("\n");
    expect(problems).toContain("src/lib/consent.ts: owned by 1.3 and 1.7, which run at the same time (M1 stage B)");
    expect(problems).toContain("unknown package 9.9");
    expect(problems).toContain("8.1: not in any milestone");
  });

  it("gives this package's own files to 1.0", () => {
    const files = [
      "scripts/check-migrations.mjs", "scripts/check-migrations.d.mts", "scripts/check-schema-drift.mjs",
      "scripts/check-ownership.mjs", "scripts/req-coverage.mjs", "docs/plan/ownership.json", "package.json",
      ".github/workflows/ci.yml", ".gitignore", "tests/migrations.test.ts", "tests/helpers.ts", "tests/runs.test.ts",
      "tests/guard-rails.test.ts", "tests/fixture-server.test.ts", "e2e/fixtures/fixture-server.mjs",
      "e2e/fixtures/fixture-server.d.mts", "e2e/helpers.ts", "playwright.config.ts", "src/lib/runs.ts",
      "src/app/api/admin/runs/[id]/route.ts",
    ];
    expect(unownedFiles(manifest, "1.0", files)).toEqual([]);
  });

  it("refuses files outside a package, and allows its stubs and the shared docs", () => {
    expect(unownedFiles(manifest, "1.2", ["src/lib/forms/index.ts", "src/lib/testimonials.ts", "README.md"])).toEqual([
      "src/lib/testimonials.ts",
      "README.md",
    ]);
    expect(unownedFiles(manifest, "2.Z", ["README.md", "docs/help/forms.md", "e2e/security-forms.spec.ts"])).toEqual([]);
    expect(unownedFiles(manifest, "6.1", ["src/lib/importers/sources/google.ts"])).toEqual([]);
    expect(unownedFiles(manifest, "2.5", ["src/app/admin/projects/[id]/forms/[formId]/NotifySection.tsx"])).toHaveLength(1);
    expect(ownersOf(manifest, "src/app/admin/projects/[id]/forms/[formId]/NotifySection.tsx")).toEqual(["7.1"]);
    expect(() => unownedFiles(manifest, "9.9", [])).toThrow(/Unknown package/);
  });

  it("says when the command is pointed at a package the manifest doesn't know", () => {
    const run = spawnSync(process.execPath, ["scripts/check-ownership.mjs", "--package", "9.9", "--base", "HEAD"], { cwd: ROOT, encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Unknown package "9.9"');
  });
});

describe("requirement coverage", () => {
  it("reads test titles from it, test and describe calls, without skipped or todo ones", () => {
    const source = [
      'describe("FORM-01 forms", () => {',
      '  it("FORM-02 builder", () => {});',
      "  test('FORM-03 engine', async () => {});",
      '  it.skipIf(!ok)("FORM-04 answers", () => {});',
      '  test.describe("FORM-05 optional", () => {});',
      '  it.skip("FORM-06 custom fields", () => {});',
      '  it.todo("FORM-07 hidden fields");',
      '  test.fixme("FORM-08 design", () => {});',
      "  it(`FORM-09 labels`, () => {});",
      '  it("says \\"FORM-10\\" in quotes", () => {});',
      "});",
    ].join("\n");
    const titles = testTitles(source);
    expect(titles.map((t) => t.title)).toEqual([
      "FORM-01 forms",
      "FORM-02 builder",
      "FORM-03 engine",
      "FORM-04 answers",
      "FORM-05 optional",
      "FORM-09 labels",
      'says \\"FORM-10\\" in quotes',
    ]);
    expect(titles[2].line).toBe(3);
  });

  it("matches whole requirement IDs only", () => {
    const titles = [{ title: "FORM-010 not this", line: 1 }, { title: "XFORM-01 nor this", line: 2 }, { title: "covers FORM-01, at last", line: 3 }];
    expect(coverage(["FORM-01", "FORM-02"], titles)).toEqual({ "FORM-01": [titles[2]], "FORM-02": [] });
  });

  it("gates each milestone's IDs, and every ID with --all (54 from Phase 1, then M9's REQ-01..07)", () => {
    expect(requirementsFor(manifest, "M1")).toEqual(["TEAM-04", "TEAM-05"]);
    expect(requirementsFor(manifest, "M2")).toContain("FORM-18");
    expect(requirementsFor(manifest, "M9")).toEqual(["REQ-01", "REQ-02", "REQ-03", "REQ-04", "REQ-05", "REQ-06", "REQ-07"]);
    const all = requirementsFor(manifest, "all");
    expect(all).toHaveLength(61);
    expect(new Set(all).size).toBe(all.length);
    expect(() => requirementsFor(manifest, "M10")).toThrow(/Unknown milestone/);
  });

  it("prints the table and passes with --report", () => {
    const run = spawnSync(process.execPath, ["scripts/req-coverage.mjs", "--all", "--report"], { cwd: ROOT, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/All milestones: \d+ of 61 requirements covered/);
  });
});
