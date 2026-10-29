import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
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
    // Phase 2 and 3 milestones (M9 on) gate requirement IDs only; they have no work packages.
    expect(Object.keys(manifest.milestones)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M9", "M10", "M11", "M12", "M13", "M14", "M16", "M17", "M18"]);
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

  it("gates each milestone's IDs, and every ID with --all (54 from Phase 1, then M9's REQ-01..07, M10's 8, M11's 6, M12's 10, M13's 6, M14's 9, M16's 5, M17's 4 and M18's 3 new ones)", () => {
    expect(requirementsFor(manifest, "M1")).toEqual(["TEAM-04", "TEAM-05"]);
    expect(requirementsFor(manifest, "M2")).toContain("FORM-18");
    expect(requirementsFor(manifest, "M9")).toEqual(["REQ-01", "REQ-02", "REQ-03", "REQ-04", "REQ-05", "REQ-06", "REQ-07"]);
    expect(requirementsFor(manifest, "M10")).toEqual(["BOOST-01", "BOOST-02", "BOOST-03", "BOOST-04", "BOOST-05", "FORM-12", "FORM-13", "REQ-08"]);
    expect(requirementsFor(manifest, "M11")).toEqual(["DISP-13", "DISP-14", "FORM-15", "WALL-05", "SEO-04", "AN-01"]);
    expect(requirementsFor(manifest, "M12")).toEqual(["VID-01", "VID-02", "VID-03", "VID-04", "WALL-04", "SHARE-01", "SHARE-02", "SHARE-03", "DISP-08", "WALL-07"]);
    expect(requirementsFor(manifest, "M13")).toEqual(["IMP-02", "IMP-04", "INBOX-11", "INBOX-12", "INBOX-13", "INBOX-14"]);
    // M14 also lists REQ-07 (from M9) for its native Stripe and Shopify triggers; --all counts it once.
    expect(requirementsFor(manifest, "M14")).toEqual(["TEAM-01", "TEAM-02", "TEAM-03", "API-01", "API-02", "INT-03", "INT-04", "INT-05", "INT-06", "REQ-07"]);
    expect(requirementsFor(manifest, "M16")).toEqual(["VID-05", "VID-06", "VID-07", "VID-08", "FORM-17"]);
    expect(requirementsFor(manifest, "M17")).toEqual(["SHARE-04", "VOC-01", "NPS-01", "IMP-07"]);
    expect(requirementsFor(manifest, "M18")).toEqual(["INT-07", "INT-08", "EXT-01"]);
    const all = requirementsFor(manifest, "all");
    expect(all).toHaveLength(112);
    expect(new Set(all).size).toBe(all.length);
    // M15 shipped follow-ups to IDs other milestones gate, so it has no entry of its own.
    expect(() => requirementsFor(manifest, "M15")).toThrow(/Unknown milestone/);
  });

  it("prints the table and passes with --report", () => {
    const run = spawnSync(process.execPath, ["scripts/req-coverage.mjs", "--all", "--report"], { cwd: ROOT, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/All milestones: \d+ of 112 requirements covered/);
  });
});

describe("TEAM-01 role guards", () => {
  it("TEAM-01 every handler under /api/admin calls requireRole or requireOwner (sign-in and sign-out excepted)", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src/app/api/admin"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f.endsWith("/route.ts"));
    expect(files.length).toBeGreaterThan(100);
    const unguarded: string[] = [];
    const levels = new Map<string, string>();
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      const handlers = [...src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)];
      handlers.forEach((m, i) => {
        const body = src.slice(m.index, handlers[i + 1]?.index ?? src.length);
        const route = `${m[1]} ${file.replace("src/app/api/admin/", "").replace("/route.ts", "")}`;
        const level = /requireRole\(req, "(viewer|editor|admin|owner)"\)/.exec(body)?.[1] ?? (/requireOwner\(req\)/.test(body) ? "owner" : null);
        if (level) levels.set(route, level);
        else if (!["POST login", "POST logout"].includes(route)) unguarded.push(route);
      });
    }
    expect(unguarded).toEqual([]);
    // What only admins (or the owner) may do: the team, keys, webhooks, channels, the server, new projects, the audit log.
    for (const route of ["GET api-keys", "POST api-keys", "POST webhooks", "PATCH webhooks/[id]", "POST notification-channels", "GET team", "POST team", "PATCH team", "GET audit", "POST projects", "DELETE projects/[id]", "POST import", "POST system/storage"]) {
      expect(["admin", "owner"], route).toContain(levels.get(route));
    }
    // Editors may run campaigns, but viewers only read and share.
    expect(levels.get("PATCH campaigns/[id]")).toBe("editor");
    expect(levels.get("PATCH testimonials/[id]")).toBe("editor");
    expect(levels.get("POST projects/[id]/share/render")).toBe("viewer");
    expect(levels.get("GET projects/[id]/testimonials")).toBe("viewer");
    // M16: viewers may watch renders; making, using, downloading or deleting one needs an editor.
    for (const route of ["GET testimonials/[id]/renders", "GET renders/[id]", "GET projects/[id]/reels", "GET projects/[id]/reels/candidates", "GET reels/[id]", "GET forms/[id]/videos"]) {
      expect(levels.get(route), route).toBe("viewer");
    }
    for (const route of [
      "POST testimonials/[id]/multiclip",
      "PUT testimonials/[id]/multiclip",
      "POST testimonials/[id]/social-clip",
      "DELETE renders/[id]",
      "GET renders/[id]/download",
      "POST projects/[id]/reels",
      "PUT reels/[id]",
      "DELETE reels/[id]",
      "POST reels/[id]/render",
      "POST forms/[id]/videos",
      "DELETE forms/[id]/videos",
    ]) {
      expect(levels.get(route), route).toBe("editor");
    }
    // M17: viewers read case studies, insights, NPS and reports; making, changing, sending anything to the AI provider, OCR and CSV exports need an editor; the project's AI switch an admin.
    for (const route of ["GET projects/[id]/case-studies", "GET case-studies/[id]", "GET case-studies/[id]/pdf", "GET projects/[id]/insights", "POST projects/[id]/insights/ask", "GET projects/[id]/nps", "GET projects/[id]/insight-reports", "GET insight-reports/[id]"]) {
      expect(levels.get(route), route).toBe("viewer");
    }
    for (const route of [
      "POST projects/[id]/case-studies",
      "PUT case-studies/[id]",
      "DELETE case-studies/[id]",
      "POST case-studies/[id]/draft",
      "POST projects/[id]/insights/themes",
      "POST projects/[id]/insight-reports",
      "DELETE insight-reports/[id]",
      "GET insight-reports/[id]/csv",
      "POST projects/[id]/survey-draft",
      "POST projects/[id]/ocr",
    ]) {
      expect(levels.get(route), route).toBe("editor");
    }
    expect(levels.get("PUT projects/[id]/ai")).toBe("admin");
    // M18: viewers see the Stripe connection (never its secrets) and read social drafts; editors change drafts,
    // ask AI to rewrite one and remove a "Verified purchase" mark; the connection and its purchases are admin-only, like webhooks and keys.
    for (const route of ["GET projects/[id]/stripe", "GET testimonials/[id]/social-draft"]) {
      expect(levels.get(route), route).toBe("viewer");
    }
    for (const route of ["PUT testimonials/[id]/social-draft", "DELETE testimonials/[id]/social-draft", "POST testimonials/[id]/social-draft/rewrite", "PUT testimonials/[id]/verified-purchase"]) {
      expect(levels.get(route), route).toBe("editor");
    }
    for (const route of ["PUT projects/[id]/stripe", "DELETE projects/[id]/stripe", "DELETE projects/[id]/purchases"]) {
      expect(levels.get(route), route).toBe("admin");
    }
  });
});
