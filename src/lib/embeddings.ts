import crypto from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { WebhookEvent } from "@/db/schema";
import { env } from "./env";
import { enqueue, PermanentJobError, registerJob, registerPeriodic } from "./jobs";
import { ProviderError, providerJson } from "./provider-fetch";
import { type EventContext, registerEventListener } from "./webhooks";

const { testimonials, answers, testimonialEmbeddings } = schema;

/**
 * Smart search (INBOX-14) with the owner's own OpenAI-compatible embeddings
 * endpoint (EMBEDDINGS_API_URL, EMBEDDINGS_API_KEY, EMBEDDINGS_MODEL). Off
 * until a model is set. When it's on, each testimonial's headline, text,
 * transcript and answers are sent to that provider to be embedded, so only
 * turn it on with a provider you trust with them. Vectors are stored
 * normalised (float32), and a search ranks a project's rows by cosine
 * similarity in memory, which is quick up to tens of thousands of rows.
 */

export const EMBED_JOB = "search.embed";
export const EMBED_BACKFILL_TASK = "search.backfill";
/** Characters of a testimonial sent to be embedded. */
const MAX_CHARS = 8000;
/** Inputs per call to the provider. */
const BATCH = 64;
/** Rows (re)embedded per backfill tick. */
const BACKFILL_ROWS = 256;
/** Results a smart search keeps, best first. */
export const MAX_RESULTS = 100;
/** Below this similarity a row isn't shown at all. */
const MIN_SCORE = 0.15;

export { ProviderError };

export function embeddingsEnabled() {
  return Boolean(env.embeddingsModel && env.embeddingsApiUrl);
}

/** What a testimonial is searched by: its headline, text, transcript and every answer. */
export function embeddingText(t: { headline: string | null; text: string | null; transcript: string | null }, extra: (string | null)[] = []) {
  return [t.headline, t.text, t.transcript, ...extra]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_CHARS);
}

const hashOf = (text: string) => crypto.createHash("sha256").update(`${env.embeddingsModel}\n${text}`).digest("hex");

function normalise(v: number[]): Float32Array {
  const out = Float32Array.from(v);
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

/** Embeds texts with the owner's provider, in order. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (!embeddingsEnabled()) throw new ProviderError("Smart search isn't set up on this server (EMBEDDINGS_MODEL)");
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH);
    const json = (await providerJson(
      `${env.embeddingsApiUrl}/embeddings`,
      { model: env.embeddingsModel, input },
      { headers: env.embeddingsApiKey ? { Authorization: `Bearer ${env.embeddingsApiKey}` } : {}, timeoutMs: 60_000, maxBytes: 64 * 1024 * 1024 },
    )) as { data?: { embedding?: unknown; index?: number }[] };
    const data = Array.isArray(json.data) ? [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
    if (data.length !== input.length || data.some((d) => !Array.isArray(d.embedding) || !(d.embedding as unknown[]).length)) {
      throw new ProviderError("The embeddings provider's answer didn't match what was sent");
    }
    for (const d of data) out.push(normalise(d.embedding as number[]));
  }
  return out;
}

const toBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Buffer) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

type Row = { id: string; projectId: string; headline: string | null; text: string | null; transcript: string | null };

/** The text and its hash for each row, answers included. */
function contentOf(rows: Row[]) {
  const extra = new Map<string, string[]>();
  if (rows.length) {
    for (const a of getDb().select({ id: answers.testimonialId, text: answers.text, transcript: answers.transcript }).from(answers).where(inArray(answers.testimonialId, rows.map((r) => r.id))).orderBy(asc(answers.position)).all()) {
      extra.set(a.id, [...(extra.get(a.id) ?? []), a.text ?? "", a.transcript ?? ""]);
    }
  }
  return rows.map((r) => {
    const text = embeddingText(r, extra.get(r.id) ?? []);
    return { row: r, text, hash: hashOf(text) };
  });
}

/**
 * (Re)embeds these testimonials: unchanged ones (same text, same model) are
 * skipped, so editing a tag or approving costs nothing. Rows with no words
 * lose their embedding. Returns how many were sent to the provider.
 */
export async function embedTestimonials(ids: string[]): Promise<number> {
  if (!embeddingsEnabled() || !ids.length) return 0;
  const db = getDb();
  const rows = db.select({ id: testimonials.id, projectId: testimonials.projectId, headline: testimonials.headline, text: testimonials.text, transcript: testimonials.transcript }).from(testimonials).where(inArray(testimonials.id, ids)).all();
  const stored = new Map(db.select({ id: testimonialEmbeddings.testimonialId, hash: testimonialEmbeddings.contentHash, model: testimonialEmbeddings.model }).from(testimonialEmbeddings).where(inArray(testimonialEmbeddings.testimonialId, ids)).all().map((r) => [r.id, r]));
  const todo = contentOf(rows).filter((c) => {
    const s = stored.get(c.row.id);
    if (!c.text) {
      if (s) db.delete(testimonialEmbeddings).where(eq(testimonialEmbeddings.testimonialId, c.row.id)).run();
      return false;
    }
    return !s || s.hash !== c.hash || s.model !== env.embeddingsModel;
  });
  if (!todo.length) return 0;
  const vectors = await embedTexts(todo.map((c) => c.text));
  const now = new Date();
  db.transaction((tx) => {
    todo.forEach((c, i) => {
      const values = { projectId: c.row.projectId, model: env.embeddingsModel, dims: vectors[i].length, vector: toBlob(vectors[i]), contentHash: c.hash, updatedAt: now };
      tx.insert(testimonialEmbeddings)
        .values({ testimonialId: c.row.id, ...values })
        .onConflictDoUpdate({ target: testimonialEmbeddings.testimonialId, set: values })
        .run();
    });
  });
  return todo.length;
}

/** The hourly backfill: rows without an embedding for the current model, or changed since. Returns how many it embedded. */
export async function backfillEmbeddings(limit = BACKFILL_ROWS): Promise<number> {
  if (!embeddingsEnabled()) return 0;
  const e = testimonialEmbeddings;
  const ids = getDb()
    .select({ id: testimonials.id })
    .from(testimonials)
    .leftJoin(e, eq(e.testimonialId, testimonials.id))
    .where(
      and(
        ne(testimonials.status, "trashed"),
        // Rows with nothing to embed (a video without a transcript) would otherwise be picked every time.
        sql`(coalesce(${testimonials.headline}, '') || coalesce(${testimonials.text}, '') || coalesce(${testimonials.transcript}, '')) <> ''`,
        or(isNull(e.testimonialId), ne(e.model, env.embeddingsModel), sql`${e.updatedAt} < ${testimonials.updatedAt}`),
      ),
    )
    .orderBy(asc(testimonials.createdAt))
    .limit(limit)
    .all()
    .map((r) => r.id);
  let done = 0;
  for (let i = 0; i < ids.length; i += BATCH) done += await embedTestimonials(ids.slice(i, i + BATCH));
  // Rows whose text didn't change still get a fresh timestamp, so they aren't picked again.
  if (ids.length) getDb().update(e).set({ updatedAt: new Date() }).where(inArray(e.testimonialId, ids)).run();
  return done;
}

/** New and edited testimonials are embedded a little later (one job per change; unchanged text is skipped). */
const EMBED_EVENTS = new Set<WebhookEvent>(["testimonial.created", "testimonial.updated", "testimonial.transcribed"]);
export function embedOnChange(event: WebhookEvent, ctx: EventContext) {
  try {
    if (!embeddingsEnabled() || !ctx.testimonial || !EMBED_EVENTS.has(event)) return;
    enqueue(EMBED_JOB, { testimonialId: ctx.testimonial.id }, { runAt: new Date(Date.now() + 30_000), maxAttempts: 3 });
  } catch (err) {
    console.error("[search] couldn't queue an embedding:", err);
  }
}

// Registered when this module loads, so route bundles that change testimonials (and import it) queue embeddings too.
registerEventListener(embedOnChange);

export function registerEmbeddingJobs(): void {
  registerEventListener(embedOnChange);
  registerJob(EMBED_JOB, async (payload) => {
    try {
      await embedTestimonials([(payload as { testimonialId: string }).testimonialId]);
    } catch (err) {
      if (!embeddingsEnabled()) throw new PermanentJobError("Smart search was turned off");
      throw err;
    }
  });
  registerPeriodic(EMBED_BACKFILL_TASK, 60 * 60 * 1000, () => backfillEmbeddings());
}

// ------------------------------------------------------------------ search

const queryCache = new Map<string, { v: Float32Array; at: number }>();
const QUERY_TTL = 10 * 60 * 1000;

/** A query's embedding, kept for 10 minutes so paging through results doesn't ask again. */
async function embedQuery(q: string): Promise<Float32Array> {
  const key = `${env.embeddingsModel}\n${q}`;
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < QUERY_TTL) return hit.v;
  const [v] = await embedTexts([q]);
  queryCache.set(key, { v, at: Date.now() });
  if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value!);
  return v;
}

/** Tests only. */
export function clearQueryCache() {
  queryCache.clear();
}

/**
 * The project's testimonials most like the query, best first (at most 100,
 * none below a minimum similarity), limited to `candidates` when given.
 * Throws ProviderError when the provider fails; the caller falls back to
 * keyword search.
 */
export async function rankBySimilarity(projectId: string, q: string, candidates?: Set<string>): Promise<{ id: string; score: number }[]> {
  const v = await embedQuery(q.trim().slice(0, 2000));
  const rows = getDb()
    .select({ id: testimonialEmbeddings.testimonialId, vector: testimonialEmbeddings.vector })
    .from(testimonialEmbeddings)
    .where(and(eq(testimonialEmbeddings.projectId, projectId), eq(testimonialEmbeddings.model, env.embeddingsModel)))
    .all();
  const scored: { id: string; score: number }[] = [];
  for (const r of rows) {
    if (candidates && !candidates.has(r.id)) continue;
    const w = fromBlob(r.vector as Buffer);
    if (w.length !== v.length) continue;
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * w[i];
    if (dot >= MIN_SCORE) scored.push({ id: r.id, score: dot });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}
