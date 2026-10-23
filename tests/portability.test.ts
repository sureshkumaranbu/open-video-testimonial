import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as exportRoute } from "@/app/api/admin/projects/[id]/export/route";
import { POST as importCsvRoute } from "@/app/api/admin/projects/[id]/import-csv/route";
import { POST as previewRoute } from "@/app/api/admin/projects/[id]/import-csv/preview/route";
import { POST as importRoute } from "@/app/api/admin/import/route";
import { GET as jobRoute } from "@/app/api/admin/jobs/[id]/route";
import { POST as startAdminUpload } from "@/app/api/admin/uploads/route";
import { PUT as putChunk } from "@/app/api/uploads/[id]/route";
import { POST as submit } from "@/app/api/projects/[slug]/testimonials/route";
import { getDb, schema } from "@/db";
import { listConsentEvents } from "@/lib/consent";
import { detectMapping, downloadPublic, guessOrigin, isPrivateAddress, parseRating } from "@/lib/csv-import";
import { parseCsv, toCsv } from "@/lib/csv";
import { env } from "@/lib/env";
import { runDueJobs } from "@/lib/jobs";
import { createRequests } from "@/lib/requests";
import { saveFile } from "@/lib/storage";
import {
  createProject,
  createTestimonial,
  getProjectById,
  getProjectBySlug,
  listTestimonials,
  updateTestimonial,
} from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { extractEntry, openZip, zipStream } from "@/lib/zip";
import { adminHeaders, params, PNG_BYTES, SAMPLE_WEBM, submissionForm, submitRequest, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  delete process.env.IMPORT_ALLOW_PRIVATE_URLS;
  ctx.cleanup();
});

const admin = (url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...adminHeaders(), "content-type": "application/json" },
  });

async function writeZip(file: string, entries: Parameters<typeof zipStream>[0], opts?: Parameters<typeof zipStream>[1]) {
  const out = fs.createWriteStream(file);
  for await (const chunk of zipStream(entries, opts)) out.write(chunk);
  await new Promise<void>((r) => out.end(() => r()));
}

describe("zip", () => {
  for (const [label, opts] of [["standard", undefined], ["ZIP64", { zip64Above: 10 }]] as const) {
    it(`writes ${label} archives that unzip and Python read, and reads them back`, async () => {
      const file = path.join(ctx.dir, `t-${label}.zip`);
      const text = "héllo ".repeat(200);
      await writeZip(file, [{ name: "a/hello.txt", data: text }, { name: "media/clip.webm", file: SAMPLE_WEBM }, { name: "empty.txt", data: "" }], opts);

      execFileSync("unzip", ["-tq", file]); // throws on any CRC or structure error
      const listed = execFileSync("python3", [
        "-I", "-c",
        "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(sorted(z.namelist()))",
        file,
      ]).toString();
      expect(listed).toContain("None");
      expect(listed).toContain("'a/hello.txt', 'empty.txt', 'media/clip.webm'");

      const zip = await openZip(file);
      expect([...zip.entries.keys()]).toEqual(["a/hello.txt", "media/clip.webm", "empty.txt"]);
      const out = path.join(ctx.dir, "out.webm");
      await extractEntry(zip, zip.entries.get("media/clip.webm")!, out, 10 * 1024 * 1024);
      expect(fs.readFileSync(out).equals(fs.readFileSync(SAMPLE_WEBM))).toBe(true);
      await extractEntry(zip, zip.entries.get("a/hello.txt")!, out, 1e6);
      expect(fs.readFileSync(out, "utf8")).toBe(text);
      expect(zip.entries.get("a/hello.txt")!.method).toBe(8); // text is deflated
    });
  }

  it("reads archives made by other tools, and refuses oversized or corrupt entries", async () => {
    const dir = path.join(ctx.dir, "src");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "big.txt"), "a".repeat(100_000));
    const file = path.join(ctx.dir, "py.zip");
    execFileSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED);z.write(sys.argv[2],'big.txt');z.close()", file, path.join(dir, "big.txt")]);
    const zip = await openZip(file);
    const entry = zip.entries.get("big.txt")!;
    expect(entry.compressedSize).toBeLessThan(1000);
    await extractEntry(zip, entry, path.join(ctx.dir, "ok.txt"), 200_000);
    // A small limit stops a zip bomb even if the header lied about the size.
    await expect(extractEntry(zip, { ...entry, size: 10 }, path.join(ctx.dir, "x"), 1000)).rejects.toThrow(/too large/);
    await expect(extractEntry(zip, { ...entry, crc: 1 }, path.join(ctx.dir, "y"), 200_000)).rejects.toThrow(/corrupt/);

    fs.writeFileSync(path.join(ctx.dir, "junk.zip"), "not a zip at all");
    await expect(openZip(path.join(ctx.dir, "junk.zip"))).rejects.toThrow(/Not a ZIP/);
  });
});

describe("CSV", () => {
  it("round-trips quotes, commas and newlines, and neutralises formulas", () => {
    const csv = toCsv(["a", "b"], [["x, y", 'say "hi"\nthere'], ["=SUM(A1)", null]]);
    expect(csv).toBe('a,b\r\n"x, y","say ""hi""\nthere"\r\n\'=SUM(A1),\r\n');
    expect(parseCsv(csv)).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere'], ["'=SUM(A1)", ""]]);
    expect(parseCsv("﻿a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("matches columns from other tools' documented field names", () => {
    expect(detectMapping(["User name", "User email", "User title", "Review body", "Rating", "Video URL", "Review date", "Tags", "User avatar"])).toEqual({
      name: "User name",
      email: "User email",
      title: "User title",
      text: "Review body",
      rating: "Rating",
      videoUrl: "Video URL",
      date: "Review date",
      tags: "Tags",
      avatarUrl: "User avatar",
    });
    expect(detectMapping(["name", "rating", "text", "email", "job title", "customer_company", "video_mp4_url", "testimonial_title"])).toMatchObject({
      name: "name",
      title: "job title",
      company: "customer_company",
      videoUrl: "video_mp4_url",
    });
    expect(guessOrigin(["name", "testimonial_title"])).toBe("senja");
    expect(guessOrigin(["User name", "Review body"])).toBe("testimonial-to");
    expect(guessOrigin(["Name", "Quote"])).toBe("csv");
  });

  it("understands ratings in several forms", () => {
    expect(["5", "4.6", "4/5", "8 out of 10", "★★★☆☆", "9", "0", "lots", ""].map(parseRating)).toEqual([5, 5, 4, 4, 3, 5, null, null, null]);
  });
});

describe("export", () => {
  async function seedProject() {
    const video = await saveFile(SAMPLE_WEBM, "video/webm", "video");
    const res = await submit(
      submitRequest("acme", submissionForm({ name: "Ada", email: "ada@example.com", text: "Hello, \"world\"", rating: "5", consent: "on", consentSocial: "on" })),
      params({ slug: "acme" }),
    );
    const { id } = await res.json();
    updateTestimonial(id, { status: "approved", tags: ["home"], authorName: "Ada L." });
    const v = createTestimonial(projectId, { name: "Vid", videoKey: video.key, videoMime: video.mime });
    updateTestimonial(v.id, { transcript: "Spoken words.", captionsVtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSpoken\n" });
    createRequests(getProjectById(projectId)!, [{ email: "bo@example.com", name: "Bo" }], { send: false });
    return { textId: id, videoId: v.id, videoKey: video.key };
  }

  it("downloads one zip with plaudit.json, a CSV and every media file", async () => {
    const { textId, videoKey } = await seedProject();
    const res = await exportRoute(admin(`/api/admin/projects/${projectId}/export`), params({ id: projectId }));
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="plaudit-acme-\d{4}-\d{2}-\d{2}\.zip"$/);
    const file = path.join(ctx.dir, "export.zip");
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    execFileSync("unzip", ["-tq", file]);

    const zip = await openZip(file);
    expect([...zip.entries.keys()].sort()).toEqual(["README.txt", `media/${videoKey}`, "plaudit.json", "testimonials.csv"].sort());
    const manifestPath = path.join(ctx.dir, "m.json");
    await extractEntry(zip, zip.entries.get("plaudit.json")!, manifestPath, 1e7);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({ format: "plaudit-export", version: 1, project: { slug: "acme", name: "Acme" } });
    const ada = manifest.testimonials.find((t: { id: string }) => t.id === textId);
    expect(ada).toMatchObject({
      status: "approved",
      author: { name: "Ada L.", email: "ada@example.com" },
      tags: ["home"],
      consent: { scopes: ["website", "social"], editedAfterConsent: true },
    });
    expect(ada.consent.events.map((e: { type: string }) => e.type)).toEqual(["granted", "edited"]);
    expect(manifest.consentVersions).toHaveLength(1);
    expect(manifest.requests[0]).toMatchObject({ email: "bo@example.com", status: "waiting" });

    const csvPath = path.join(ctx.dir, "t.csv");
    await extractEntry(zip, zip.entries.get("testimonials.csv")!, csvPath, 1e7);
    const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
    expect(rows[0]).toContain("edited_after_consent");
    expect(rows.find((r) => r[2] === "Ada L.")).toContain('Hello, "world"');

    const csvOnly = await exportRoute(admin(`/api/admin/projects/${projectId}/export?format=csv`), params({ id: projectId }));
    expect(csvOnly.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  });

  it("imports its own export as a new project, keeping data, consent history and media", async () => {
    await seedProject();
    const exported = Buffer.from(await (await exportRoute(admin(`/api/admin/projects/${projectId}/export`), params({ id: projectId }))).arrayBuffer());

    // Upload the archive in chunks, as the browser does.
    const { id, token } = await (await startAdminUpload(admin("/api/admin/uploads", {}))).json();
    for (let offset = 0; offset < exported.length; offset += 40_000) {
      const res = await putChunk(
        new Request(`http://localhost/api/uploads/${id}?offset=${offset}`, {
          method: "PUT",
          body: new Blob([new Uint8Array(exported.subarray(offset, offset + 40_000))]),
          headers: { "x-upload-token": token, ...adminHeaders() },
        }),
        params({ id }),
      );
      expect(res.status).toBe(200);
    }
    const started = await importRoute(admin("/api/admin/import", { uploadId: id, token }));
    expect(started.status).toBe(202);
    const body = await started.json();
    expect(body.project.slug).toBe("acme-2"); // "acme" is taken on this server
    expect(body.counts).toEqual({ testimonials: 2, requests: 1 });
    await runDueJobs();
    const job = await (await jobRoute(admin(`/api/admin/jobs/${body.jobId}`), params({ id: body.jobId }))).json();
    expect(job).toMatchObject({ status: "done", error: null });

    const copy = getProjectBySlug("acme-2")!;
    const items = listTestimonials(copy.id);
    expect(items).toHaveLength(2);
    const ada = items.find((t) => t.authorName === "Ada L.")!;
    expect(ada).toMatchObject({ status: "approved", tags: ["home"], editedAfterConsent: true, authorEmail: "ada@example.com" });
    expect(listConsentEvents(ada.id).map((e) => e.type)).toEqual(["granted", "edited", "imported"]);
    const vid = items.find((t) => t.authorName === "Vid")!;
    expect(vid.transcript).toBe("Spoken words.");
    // The original is byte-for-byte the same (the worker may also have made an MP4 from it).
    expect(fs.readFileSync(path.join(env.uploadsDir, vid.videoOriginalKey!)).equals(fs.readFileSync(SAMPLE_WEBM))).toBe(true);
    const requests = getDb().select().from(schema.requests).all().filter((r) => r.projectId === copy.id);
    expect(requests).toMatchObject([{ email: "bo@example.com", nextReminderAt: null }]);
    // The temporary archive is gone.
    expect(fs.readdirSync(env.tmpDir).filter((f) => f.startsWith("import-"))).toEqual([]);
  });

  it("refuses archives that aren't Plaudit exports", async () => {
    const zipPath = path.join(ctx.dir, "other.zip");
    await writeZip(zipPath, [{ name: "hello.txt", data: "hi" }]);
    const bytes = fs.readFileSync(zipPath);
    const { id, token } = await (await startAdminUpload(admin("/api/admin/uploads", {}))).json();
    await putChunk(
      new Request(`http://localhost/api/uploads/${id}?offset=0`, { method: "PUT", body: new Blob([new Uint8Array(bytes)]), headers: { "x-upload-token": token } }),
      params({ id }),
    );
    const res = await importRoute(admin("/api/admin/import", { uploadId: id, token }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no plaudit\.json/);
    expect(getProjectBySlug("acme-2")).toBeNull();
  });
});

describe("private address checks", () => {
  it("blocks private, loopback, mapped and NAT64 addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "0.0.0.0", "::1", "::", "::ffff:7f00:1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "fd00::1", "fe80::1", "not-an-ip"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses literal and DNS-resolved private hosts when downloading", async () => {
    const dest = path.join(ctx.dir, "dl");
    await expect(downloadPublic("http://[::ffff:127.0.0.1]:9/x", dest, 1000)).rejects.toThrow(/private address/);
    await expect(downloadPublic("http://127.0.0.1:9/x", dest, 1000)).rejects.toThrow(/private address/);
    // "localhost" resolves to loopback; the connection's own lookup refuses it.
    await expect(downloadPublic("http://localhost:9/x", dest, 1000)).rejects.toThrow(/private address/);
  });
});

describe("CSV import", () => {
  const CSV = [
    "User name,User email,User title,Review body,Rating,Review date,Tags,Video URL",
    'Ada,ada@example.com,CTO,"Great, really.",5,2025-03-01,"home, pricing",',
    "Bob,,,,4,,,",
    ",nobody@example.com,,Orphan text,3,,,",
  ].join("\n");

  it("previews the detected mapping and imports valid rows as pending", async () => {
    const preview = await (await previewRoute(admin(`/api/admin/projects/${projectId}/import-csv/preview`, { csv: CSV }))).json();
    expect(preview).toMatchObject({ origin: "testimonial-to", total: 3, valid: 1 });
    expect(preview.errors).toEqual([
      { line: 3, error: "No text or video URL" },
      { line: 4, error: "No name" },
    ]);

    const res = await importCsvRoute(admin(`/api/admin/projects/${projectId}/import-csv`, { csv: CSV }), params({ id: projectId }));
    const body = await res.json();
    expect(body).toMatchObject({ imported: 1, origin: "testimonial-to" });
    const [t] = listTestimonials(projectId);
    expect(t).toMatchObject({
      authorName: "Ada",
      authorEmail: "ada@example.com",
      authorTitle: "CTO",
      text: "Great, really.",
      rating: 5,
      status: "pending",
      source: "import:testimonial-to",
      tags: ["home", "pricing"],
    });
    expect(t.createdAt.toISOString()).toBe("2025-03-01T00:00:00.000Z");
    expect(listConsentEvents(t.id)[0]).toMatchObject({ type: "imported", actor: "import" });
  });

  it("honours a changed mapping and can approve on import", async () => {
    const csv = "Who,Said\nZed,Hello there";
    const res = await importCsvRoute(
      admin(`/api/admin/projects/${projectId}/import-csv`, { csv, mapping: { name: "Who", text: "Said" }, approve: true }),
      params({ id: projectId }),
    );
    expect((await res.json()).imported).toBe(1);
    expect(listTestimonials(projectId)[0]).toMatchObject({ authorName: "Zed", status: "approved" });
    const bad = await importCsvRoute(admin(`/api/admin/projects/${projectId}/import-csv`, { csv }), params({ id: projectId }));
    expect(bad.status).toBe(400);
  });

  it("downloads media from URLs, refusing private addresses unless allowed", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/clip.webm") {
        res.writeHead(200, { "content-type": "video/webm" });
        res.end(fs.readFileSync(SAMPLE_WEBM));
      } else if (req.url === "/face.png") {
        res.writeHead(302, { location: "/real-face.png" }).end();
      } else if (req.url === "/real-face.png") {
        res.writeHead(200).end(Buffer.from(PNG_BYTES));
      } else {
        res.writeHead(200).end("<html>not a video</html>");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const csv = `name,text,video_url,avatar\nVi,Hi,${base}/clip.webm,${base}/face.png\nNo,Hi,${base}/page.html,`;
      const run = async () => {
        await importCsvRoute(admin(`/api/admin/projects/${projectId}/import-csv`, { csv, fetchMedia: true }), params({ id: projectId }));
        for (let i = 0; i < 4; i++) await runDueJobs({ now: () => new Date(Date.now() + i * 3_600_000) });
      };
      // 127.0.0.1 is private, so by default nothing is fetched.
      await run();
      expect(listTestimonials(projectId).every((t) => !t.videoKey && !t.avatarKey)).toBe(true);
      const failed = getDb().select().from(schema.jobs).all().filter((j) => j.type === "import.media");
      expect(failed.every((j) => j.status === "failed" && /private address/.test(j.lastError ?? ""))).toBe(true);

      process.env.IMPORT_ALLOW_PRIVATE_URLS = "true";
      for (const t of listTestimonials(projectId)) getDb().delete(schema.testimonials).where(eqId(t.id)).run();
      await run();
      const vi = listTestimonials(projectId).find((t) => t.authorName === "Vi")!;
      expect(vi.videoOriginalKey).toMatch(/\.webm$/);
      expect(vi.avatarKey).toMatch(/\.png$/); // followed the redirect
      const no = listTestimonials(projectId).find((t) => t.authorName === "No")!;
      expect(no.videoKey).toBeNull(); // an HTML page is never stored as a video
    } finally {
      server.close();
    }
  });
});

const eqId = (id: string) => eq(schema.testimonials.id, id);
