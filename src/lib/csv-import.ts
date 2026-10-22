import crypto from "node:crypto";
import dnsCallback from "node:dns";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Project } from "@/db/schema";
import { logConsentEvent } from "./consent";
import { parseCsvRecords } from "./csv";
import { env } from "./env";
import { enqueue, PermanentJobError } from "./jobs";
import { queueVideoProcessing } from "./media";
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
  avatarUrl: ["avatarurl", "avatar", "userphoto", "useravatar", "photo", "photourl", "profilepicture", "picture", "customeravatar"],
  videoUrl: ["videourl", "videomp4url", "video", "videolink", "videomp4"],
};

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
  if (h.has("reviewbody") || (h.has("username") && h.has("useremail"))) return "testimonial-to";
  return "csv";
}

/** "5", "4.6", "5/5", "8 out of 10", "★★★★☆" -> 1..5, or null. */
export function parseRating(raw: string | undefined) {
  if (!raw) return null;
  const stars = (raw.match(/★/g) ?? []).length;
  if (stars) return Math.min(stars, 5);
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:\/|out of)?\s*(\d+)?/i.exec(raw);
  if (!m) return null;
  let n = Number(m[1].replace(",", "."));
  const scale = m[2] ? Number(m[2]) : n > 5 && n <= 10 ? 10 : 5;
  if (scale && scale !== 5) n = (n / scale) * 5;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

function parseDate(raw: string | undefined) {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) && t < Date.now() + 86_400_000 ? new Date(t) : null;
}

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
  error: string | null;
}

export function mapRows(records: Record<string, string>[], mapping: Mapping): MappedRow[] {
  const get = (r: Record<string, string>, f: ImportField) => (mapping[f] ? (r[mapping[f]!] ?? "").trim() : "");
  return records.map((r, i) => {
    const url = (v: string) => (v && httpUrl.safeParse(v).success ? v : null);
    const email = get(r, "email").toLowerCase();
    const row: MappedRow = {
      line: i + 2,
      name: get(r, "name").slice(0, 120),
      email: z.email().safeParse(email).success ? email : null,
      title: get(r, "title").slice(0, 120) || null,
      company: get(r, "company").slice(0, 120) || null,
      text: get(r, "text").slice(0, 5000) || null,
      rating: parseRating(get(r, "rating")),
      date: parseDate(get(r, "date")),
      tags: get(r, "tags")
        .split(/[,;|]/)
        .map((t) => t.trim().toLowerCase().slice(0, 32))
        .filter(Boolean)
        .slice(0, 20),
      avatarUrl: url(get(r, "avatarUrl")),
      videoUrl: url(get(r, "videoUrl")),
      error: null,
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
  };
}

export const FETCH_MEDIA_JOB = "import.media";

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
  const skipped: { line: number; error: string }[] = [];
  for (const row of rows) {
    if (row.error) {
      skipped.push({ line: row.line, error: row.error });
      continue;
    }
    const t = createTestimonial(
      project.id,
      {
        name: row.name,
        email: row.email ?? undefined,
        title: row.title ?? undefined,
        company: row.company ?? undefined,
        text: row.text ?? undefined,
        rating: row.rating ?? undefined,
      },
      { source: `import:${origin}`, createdAt: row.date ?? undefined },
    );
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
  return { imported, skipped, origin };
}

// ------------------------------------------------------------ fetching media

// Loopback, private, link-local, carrier-grade NAT, benchmarking, multicast and
// reserved ranges, plus IPv4-mapped/NAT64 IPv6 (which can point back at them).
// Separate lists: a BlockList checks IPv4 addresses against IPv6 rules as
// mapped addresses, so one list with ::ffff:0:0/96 would block every IPv4 address.
const BLOCKED_V4 = new net.BlockList();
const BLOCKED_V6 = new net.BlockList();
for (const [net4, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) BLOCKED_V4.addSubnet(net4, bits, "ipv4");
for (const [net6, bits] of [
  ["::", 127], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) BLOCKED_V6.addSubnet(net6, bits, "ipv6");

export function isPrivateAddress(ip: string) {
  const family = net.isIP(ip);
  if (!family) return true;
  return family === 4 ? BLOCKED_V4.check(ip, "ipv4") : BLOCKED_V6.check(ip, "ipv6");
}

class PrivateAddressError extends PermanentJobError {}

/**
 * DNS lookup for outgoing requests that refuses private addresses. Checking
 * inside the connection's own lookup (rather than resolving separately first)
 * means a DNS answer can't change between the check and the connect.
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dnsCallback.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dnsCallback.LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new PrivateAddressError(`Refusing to fetch from a private address (${hostname})`), "", 4);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dnsCallback.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function get(url: URL, timeoutMs: number) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(url, { lookup: env.importAllowPrivateUrls ? undefined : guardedLookup, timeout: timeoutMs }, resolve);
    req.on("timeout", () => req.destroy(new Error(`No response from ${url.host}`)));
    req.on("error", reject);
  });
}

/**
 * Downloads a public file to disk with a size cap, following up to 5
 * redirects. Private-network addresses are refused (a CSV from elsewhere
 * shouldn't make the server fetch internal URLs) unless
 * IMPORT_ALLOW_PRIVATE_URLS=true.
 */
export async function downloadPublic(url: string, dest: string, maxBytes: number) {
  let current = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") throw new PermanentJobError("Only http(s) URLs");
    // IP literals skip DNS, so check them here.
    const literal = current.hostname.replace(/^\[|\]$/g, "");
    if (!env.importAllowPrivateUrls && net.isIP(literal) && isPrivateAddress(literal)) {
      throw new PrivateAddressError(`Refusing to fetch from a private address (${current.host})`);
    }
    const res = await get(current, 120_000);
    const location = res.headers.location;
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume();
      current = new URL(location, current);
      continue;
    }
    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`HTTP ${res.statusCode} for ${current.host}`);
    }
    if (Number(res.headers["content-length"] || 0) > maxBytes) {
      res.destroy();
      throw new PermanentJobError("File too large");
    }
    let size = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        done(size > maxBytes ? new PermanentJobError("File too large") : null, chunk);
      },
    });
    await pipeline(res, cap, fs.createWriteStream(dest));
    return size;
  }
  throw new PermanentJobError("Too many redirects");
}

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
