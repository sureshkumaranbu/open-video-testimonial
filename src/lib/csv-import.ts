import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { logConsentEvent } from "./consent";
import { parseCsvRecords } from "./csv";
import { env } from "./env";
import { enqueue, PermanentJobError } from "./jobs";
import { queueVideoProcessing } from "./media";
import { downloadPublic } from "./net-guard";
import { saveFile, sniffMime, type MediaKind } from "./storage";
import { createTestimonial, updateTestimonial } from "./testimonials";

/**
 * CSV import with a column mapper. Headers are matched against common
 * names, which covers Plaudit's own CSV and the column names other tools
 * document for their CSV imports (Senja, Testimonial.to and similar). We
 * couldn't check those tools' real export files, so the owner reviews and
 * can change the mapping before anything is imported.
 */
export const IMPORT_FIELDS = [
  "name",
  "email",
  "title",
  "company",
  "text",
  "rating",
  "date",
  "tags",
  "avatarUrl",
  "videoUrl",
  "platform",
  "sourceReviewId",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Partial<Record<ImportField, string>>;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header aliases, most specific first. */
const ALIASES: Record<ImportField, string[]> = {
  name: ["name", "fullname", "customername", "authorname", "reviewername", "clientname", "displayname", "username", "user"],
  email: ["email", "emailaddress", "useremail", "customeremail", "authoremail", "revieweremail"],
  title: ["jobtitle", "usertitle", "authortitle", "customertitle", "role", "position", "title"],
  company: ["company", "customercompany", "companyname", "usercompany", "organisation", "organization", "business"],
  text: ["text", "testimonial", "testimonialtext", "reviewbody", "review", "body", "content", "message", "quote", "feedback", "comment"],
  rating: ["rating", "stars", "score", "reviewrating", "starrating"],
  date: ["date", "createdat", "reviewdate", "submittedat", "submitted", "created", "timestamp"],
  tags: ["tags", "tag", "labels", "categories"],
  avatarUrl: ["avatarurl", "avatar", "userphoto", "useravatar", "photo", "photourl", "profilepicture", "profileimage", "picture", "customeravatar"],
  videoUrl: ["videourl", "videomp4url", "video", "videolink", "videomp4"],
  // Senja calls the review site "integration"; Shapo calls it "source".
  platform: ["platform", "integration", "sourceplatform", "reviewsource", "reviewplatform", "source"],
  // The original's id: re-importing the same file then skips what's already there.
  sourceReviewId: ["sourcereviewid", "reviewid", "testimonialid", "originalid", "id"],
};

/** Other tools' names for review sites, mapped to Plaudit's platform ids. */
const PLATFORM_NAMES: Record<string, string> = {
  twitter: "x",
  xcom: "x",
  producthunt: "producthunt",
  appstore: "appstore",
  apple: "appstore",
  iosappstore: "appstore",
  playstore: "googleplay",
  googleplay: "googleplay",
  googleplaystore: "googleplay",
  googlebusiness: "google",
  googlereviews: "google",
  googlemaps: "google",
  testimonialto: "testimonial-to",
  webpage: "website",
  web: "website",
};

/** "Product Hunt", "product_hunt", "PLAY_STORE" -> "producthunt", "producthunt", "googleplay"; anything else lower-cased. */
export function normalizePlatform(raw: string | null | undefined) {
  const n = (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // How a row arrived in a tool (an older Plaudit export's "source" column, say) isn't where it was posted.
  if (!n || CHANNELS.test(n)) return null;
  return PLATFORM_NAMES[n] ?? n.slice(0, 40);
}

const CHANNELS = /^(form|api|manual|csv|import\w*|request|requested)$/;

export function detectMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  for (const field of IMPORT_FIELDS) {
    for (const alias of ALIASES[field]) {
      const header = byNorm.get(alias);
      if (header && !used.has(header)) {
        mapping[field] = header;
        used.add(header);
        break;
      }
    }
  }
  return mapping;
}

/** A label for where the file probably came from (used as the testimonial source). */
export function guessOrigin(headers: string[]) {
  const h = new Set(headers.map(norm));
  if (h.has("editedafterconsent") && h.has("consentscopes")) return "plaudit";
  if (h.has("testimonialtitle") || h.has("integration") || h.has("videomp4url")) return "senja";
  if (h.has("profileimage") || (h.has("message") && h.has("link") && h.has("source"))) return "shapo";
  if (h.has("reviewbody") || (h.has("username") && h.has("useremail"))) return "testimonial-to";
  return "csv";
}

/**
 * "5", "4.6", "5/5", "8 out of 10", "★★★★☆" -> 1..5, or null. A bare number
 * must already be 1 to 5: "9" could be out of 10 or a typo, so it isn't
 * guessed (write "9/10" for a 10-point scale).
 */
export function parseRating(raw: string | undefined) {
  if (!raw) return null;
  const stars = (raw.match(/★/g) ?? []).length;
  if (stars) return Math.min(stars, 5);
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:(?:\/|out of)\s*(\d+))?\s*(?:stars?)?\s*$/i.exec(raw);
  if (!m) return null;
  let n = Number(m[1].replace(",", "."));
  const scale = m[2] ? Number(m[2]) : 5;
  if (!scale || n > scale) return null;
  if (scale !== 5) n = (n / scale) * 5;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

function parseDate(raw: string | undefined) {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) && t < Date.now() + 86_400_000 ? new Date(t) : null;
}

const quoted = (v: string) => `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;

const httpUrl = z.url({ protocol: /^https?$/ });

export interface MappedRow {
  line: number;
  name: string;
  email: string | null;
  title: string | null;
  company: string | null;
  text: string | null;
  rating: number | null;
  date: Date | null;
  tags: string[];
  avatarUrl: string | null;
  videoUrl: string | null;
  /** Where the review was first posted (normalised), and its id there: the dedupe key. */
  platform: string | null;
  sourceReviewId: string | null;
  /** Why the row can't be imported at all. */
  error: string | null;
  /** Values that were left out, so the owner knows what changed. */
  warnings: string[];
}

export type RowNote = { line: number; message: string };

export function mapRows(records: Record<string, string>[], mapping: Mapping): MappedRow[] {
  const get = (r: Record<string, string>, f: ImportField) => (mapping[f] ? (r[mapping[f]!] ?? "").trim() : "");
  return records.map((r, i) => {
    const warnings: string[] = [];
    const url = (field: "avatarUrl" | "videoUrl", label: string) => {
      const v = get(r, field);
      if (!v) return null;
      if (httpUrl.safeParse(v).success) return v;
      warnings.push(`${label} ${quoted(v)} isn't a web address, so it was left out`);
      return null;
    };
    const rawEmail = get(r, "email");
    const email = rawEmail.toLowerCase();
    const validEmail = z.email().safeParse(email).success;
    if (rawEmail && !validEmail) warnings.push(`Email ${quoted(rawEmail)} isn't valid, so it was left out`);
    const rawRating = get(r, "rating");
    const rating = parseRating(rawRating);
    if (rawRating && rating === null) {
      warnings.push(`Rating ${quoted(rawRating)} isn't 1 to 5 stars (write 9/10 for a 10-point scale), so it was imported without a rating`);
    }
    const rawDate = get(r, "date");
    const date = parseDate(rawDate);
    if (rawDate && !date) warnings.push(`Date ${quoted(rawDate)} isn't a date we can read, so the import time was used`);
    const row: MappedRow = {
      line: i + 2,
      name: get(r, "name").slice(0, 120),
      email: validEmail ? email : null,
      title: get(r, "title").slice(0, 120) || null,
      company: get(r, "company").slice(0, 120) || null,
      text: get(r, "text").slice(0, 5000) || null,
      rating,
      date,
      tags: get(r, "tags")
        .split(/[,;|]/)
        .map((t) => t.trim().toLowerCase().slice(0, 32))
        .filter(Boolean)
        .slice(0, 20),
      avatarUrl: url("avatarUrl", "Avatar URL"),
      videoUrl: url("videoUrl", "Video URL"),
      platform: normalizePlatform(get(r, "platform")),
      sourceReviewId: get(r, "sourceReviewId").slice(0, 200) || null,
      error: null,
      warnings,
    };
    if (!row.name) row.error = "No name";
    else if (!row.text && !row.videoUrl) row.error = "No text or video URL";
    return row;
  });
}

export function previewCsv(csv: string, mapping?: Mapping) {
  const { headers, records } = parseCsvRecords(csv);
  const used = mapping ?? detectMapping(headers);
  const rows = mapRows(records, used);
  return {
    headers,
    mapping: used,
    origin: guessOrigin(headers),
    total: records.length,
    valid: rows.filter((r) => !r.error).length,
    rows: rows.slice(0, 5),
    errors: rows.filter((r) => r.error).slice(0, 20).map((r) => ({ line: r.line, error: r.error })),
    ...warningsOf(rows, 20),
  };
}

/** Warnings on rows that will be imported, with line numbers: the first `max`, and how many in all. */
function warningsOf(rows: MappedRow[], max: number) {
  const all: RowNote[] = rows.filter((r) => !r.error).flatMap((r) => r.warnings.map((message) => ({ line: r.line, message })));
  return { warnings: all.slice(0, max), warningCount: all.length };
}

export const FETCH_MEDIA_JOB = "import.media";

/** Whether this project already has the review with this id from this platform (the dedupe key, D4). */
export function isAlreadyImported(projectId: string, platform: string, sourceReviewId: string) {
  const t = schema.testimonials;
  return Boolean(
    getDb()
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.projectId, projectId), eq(t.platform, platform), eq(t.sourceReviewId, sourceReviewId)))
      .get(),
  );
}

/** SQLite's answer when the dedupe index (or another unique index) already has the row. */
export function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code ?? "";
  const message = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  return code.startsWith("SQLITE_CONSTRAINT_UNIQUE") || /UNIQUE constraint failed/.test(message);
}

/**
 * Imports the mapped rows into a project. Imported testimonials start as
 * pending unless `approve` is set; media URLs are downloaded in the
 * background when `fetchMedia` is on.
 */
export function importCsv(
  project: Project,
  csv: string,
  opts: { mapping?: Mapping; approve?: boolean; fetchMedia?: boolean },
) {
  const { headers, records } = parseCsvRecords(csv);
  if (records.length > 10_000) throw new Error("Import at most 10,000 rows at a time");
  const mapping = opts.mapping ?? detectMapping(headers);
  if (!mapping.name || (!mapping.text && !mapping.videoUrl)) {
    throw new Error("Map at least the name column and a text or video URL column");
  }
  const origin = guessOrigin(headers);
  const rows = mapRows(records, mapping);
  let imported = 0;
  let duplicates = 0;
  const skipped: { line: number; error: string }[] = [];
  // A row from another testimonial tool keeps that tool's id, so the same file imported twice adds nothing new.
  const toolOrigin = ["senja", "shapo", "testimonial-to"].includes(origin) ? origin : null;
  for (const row of rows) {
    if (row.error) {
      skipped.push({ line: row.line, error: row.error });
      continue;
    }
    const platform = row.platform ?? (row.sourceReviewId ? toolOrigin : null);
    if (platform && row.sourceReviewId && isAlreadyImported(project.id, platform, row.sourceReviewId)) {
      duplicates++;
      skipped.push({ line: row.line, error: "Already imported" });
      continue;
    }
    let t;
    try {
      t = createTestimonial(
        project.id,
        {
          name: row.name,
          email: row.email ?? undefined,
          title: row.title ?? undefined,
          company: row.company ?? undefined,
          text: row.text ?? undefined,
          rating: row.rating ?? undefined,
          platform: platform ?? undefined,
          sourceReviewId: platform ? (row.sourceReviewId ?? undefined) : undefined,
          sourceDate: platform && row.date ? row.date : undefined,
          importedAt: new Date(),
        },
        { source: `import:${origin}`, createdAt: row.date ?? undefined },
      );
    } catch (err) {
      // Another import added the same review a moment ago.
      if (isUniqueViolation(err)) {
        duplicates++;
        skipped.push({ line: row.line, error: "Already imported" });
        continue;
      }
      throw err;
    }
    logConsentEvent({
      testimonialId: t.id,
      type: "imported",
      actor: "import",
      detail: "Imported from a CSV file. Consent was collected outside Plaudit; keep your own record of it.",
    });
    if (row.tags.length || opts.approve) {
      // Bulk imports don't fire webhooks.
      updateTestimonial(
        t.id,
        { tags: row.tags.length ? row.tags : undefined, status: opts.approve ? "approved" : undefined },
        { quiet: true },
      );
    }
    if (opts.fetchMedia && (row.videoUrl || row.avatarUrl)) {
      enqueue(FETCH_MEDIA_JOB, { testimonialId: t.id, videoUrl: row.videoUrl, avatarUrl: row.avatarUrl }, { maxAttempts: 3 });
    }
    imported++;
  }
  return { imported, duplicates, skipped, ...warningsOf(rows, 100), origin };
}

// ------------------------------------------------------------ fetching media

// The private-address guard moved to net-guard.ts; these stay importable from here.
export { downloadPublic, isPrivateAddress } from "./net-guard";

async function fetchInto(url: string, kind: MediaKind) {
  await fs.promises.mkdir(env.tmpDir, { recursive: true });
  const tmp = path.join(env.tmpDir, `fetch-${crypto.randomUUID()}`);
  try {
    await downloadPublic(url, tmp, kind === "video" ? env.maxVideoBytes : env.maxImageBytes);
    const head = Buffer.alloc(16);
    const fd = await fs.promises.open(tmp, "r");
    await fd.read(head, 0, 16, 0);
    await fd.close();
    const mime = sniffMime(head);
    if (!mime) throw new PermanentJobError(`${url} isn't a supported ${kind} file`);
    return await saveFile(tmp, mime, kind, { move: true });
  } catch (err) {
    if (err instanceof Error && /Unsupported/.test(err.message)) throw new PermanentJobError(err.message);
    throw err;
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

export async function fetchImportedMedia(payload: { testimonialId: string; videoUrl: string | null; avatarUrl: string | null }) {
  const db = getDb();
  const t = db.select().from(schema.testimonials).where(eq(schema.testimonials.id, payload.testimonialId)).get();
  if (!t) return;
  if (payload.avatarUrl && !t.avatarKey) {
    const stored = await fetchInto(payload.avatarUrl, "image");
    db.update(schema.testimonials).set({ avatarKey: stored.key }).where(eq(schema.testimonials.id, t.id)).run();
  }
  if (payload.videoUrl && !t.videoKey) {
    const stored = await fetchInto(payload.videoUrl, "video");
    db.update(schema.testimonials)
      .set({ videoKey: stored.key, videoOriginalKey: stored.key, videoMime: stored.mime })
      .where(eq(schema.testimonials.id, t.id))
      .run();
    await queueVideoProcessing(t.id);
  }
}
