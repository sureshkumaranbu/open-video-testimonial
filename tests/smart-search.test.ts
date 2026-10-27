import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as listRoute } from "@/app/api/admin/projects/[id]/testimonials/route";
import { getDb, schema } from "@/db";
import { backfillEmbeddings, clearQueryCache, embeddingText, rankBySimilarity } from "@/lib/embeddings";
import { runDueJobs } from "@/lib/jobs";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let server: http.Server | null = null;
let calls: string[][];
let failing = false;

/** Words that mean the same to our stand-in model, so a search can match by meaning rather than by the words. */
const SAME: Record<string, string> = { quick: "fast", speedy: "fast", delivery: "shipping", delivered: "shipping", arrived: "shipping", help: "support", helpful: "support", cost: "price", cheap: "price" };
const DIMS = ["fast", "shipping", "support", "price", "video", "setup", "slow", "other"];

/** A tiny bag-of-meanings embedding: one dimension per idea above. */
function embed(text: string) {
  const v = DIMS.map(() => 0);
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const w = SAME[raw] ?? raw;
    const i = DIMS.indexOf(w);
    v[i >= 0 ? i : DIMS.length - 1] += i >= 0 ? 1 : 0.05;
  }
  return v;
}

const ENV = ["EMBEDDINGS_API_URL", "EMBEDDINGS_API_KEY", "EMBEDDINGS_MODEL", "PLAUDIT_FEATURES"];

beforeEach(async () => {
  ctx = useTempDataDir();
  registerJobs();
  clearQueryCache();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  calls = [];
  failing = false;
});
afterEach(async () => {
  for (const k of ENV) delete process.env[k];
  if (server) await new Promise((r) => server!.close(r));
  server = null;
  ctx.cleanup();
});

async function provider() {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      calls.push(body.input);
      if (failing || req.headers.authorization !== "Bearer emb-key" || body.model !== "test-embed") {
        res.statusCode = 500;
        return res.end("{}");
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: (body.input as string[]).map((t, index) => ({ index, embedding: embed(t) })) }));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  process.env.EMBEDDINGS_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.EMBEDDINGS_API_KEY = "emb-key";
  process.env.EMBEDDINGS_MODEL = "test-embed";
}

function seed() {
  const add = (name: string, text: string, rating = 5) => {
    const id = createTestimonial(projectId, { name, text, rating }).id;
    updateTestimonial(id, { status: "approved" }, { quiet: true });
    return id;
  };
  return {
    shipping: add("Ana", "The parcel arrived fast, shipping was great."),
    support: add("Bo", "Their support team answered within minutes.", 4),
    price: add("Cy", "Good value for the price.", 2),
    video: add("Di", "Recording a video took no time."),
  };
}

const list = async (qs: string) => (await listRoute(new Request(`http://localhost/api/admin/projects/${projectId}/testimonials?${qs}`, { headers: adminHeaders() }), params({ id: projectId }))).json();

describe("INBOX-14 smart search", () => {
  it("INBOX-14 falls back to keyword search when no provider is set up, and says so", async () => {
    const ids = seed();
    const body = await list("tab=all&q=support&smart=1");
    expect(body.search).toEqual({ mode: "keyword", fallback: "off" });
    expect(body.items.map((t: { id: string }) => t.id)).toEqual([ids.support]);
    expect((await list("tab=all&q=support")).search).toBeUndefined();
  });

  it("INBOX-14 embeds headline, text, transcript and answers once, and ranks by meaning combined with the filters", async () => {
    await provider();
    const ids = seed();
    expect(await backfillEmbeddings()).toBe(4);
    expect(calls.flat()).toHaveLength(4);
    // Unchanged text isn't sent again.
    expect(await backfillEmbeddings()).toBe(0);
    expect(calls.flat()).toHaveLength(4);
    expect(getDb().select().from(schema.testimonialEmbeddings).all().map((e) => e.dims)).toEqual([8, 8, 8, 8]);

    // "quick delivery" shares no word with the shipping review; keyword search finds nothing.
    expect((await list("tab=all&q=quick%20delivery")).items).toHaveLength(0);
    const smart = await list("tab=all&q=quick%20delivery&smart=1");
    expect(smart.search).toEqual({ mode: "smart" });
    expect(smart.items[0].id).toBe(ids.shipping);
    expect(smart.counts.all).toBe(smart.total);
    const helpful = await list("tab=all&q=helpful%20people&smart=1");
    expect(helpful.items.map((t: { id: string }) => t.id)).toEqual([ids.support]);
    // Filters still apply: 5 stars only leaves the support review (4 stars) out.
    expect((await list("tab=all&q=helpful%20people&smart=1&rating=5")).items).toHaveLength(0);
    expect(embeddingText({ headline: "H", text: "T", transcript: null }, ["A"])).toBe("H\n\nT\n\nA");
  });

  it("INBOX-14 an edit is re-embedded through the job; a provider failure falls back to keyword search", async () => {
    await provider();
    const ids = seed();
    await backfillEmbeddings();
    updateTestimonial(ids.price, { text: "Cheap, and the cost was clear." });
    await runDueJobs({ now: () => new Date(Date.now() + 60_000) });
    expect(calls.at(-1)).toEqual(["Cheap, and the cost was clear."]);
    expect((await rankBySimilarity(projectId, "price"))[0].id).toBe(ids.price);

    failing = true;
    clearQueryCache();
    const body = await list("tab=all&q=support&smart=1");
    expect(body.search).toEqual({ mode: "keyword", fallback: "failed" });
    expect(body.items.map((t: { id: string }) => t.id)).toEqual([ids.support]);
  });

  it("INBOX-14 with the aisearch flag off the switch is ignored and nothing is sent", async () => {
    await provider();
    seed();
    process.env.PLAUDIT_FEATURES = "inbox2";
    const body = await list("tab=all&q=support&smart=1");
    expect(body.search).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
