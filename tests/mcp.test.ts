import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createKeyRoute } from "@/app/api/admin/api-keys/route";
import { DELETE as mcpDelete, GET as mcpGet, POST as mcpPost } from "@/app/mcp/route";
import { createCampaign, updateCampaign } from "@/lib/campaigns";
import { createProject, createTestimonial, getProjectById, updateTestimonial } from "@/lib/testimonials";
import { createWidget } from "@/lib/widgets";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let read: string;
let write: string;

async function newKey(scope: "read" | "write") {
  const res = await createKeyRoute(
    new Request("http://localhost/api/admin/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: scope, scope }),
      headers: { ...adminHeaders(), "content-type": "application/json" },
    }),
  );
  return ((await res.json()) as { key: string }).key;
}

const post = (body: unknown, o: { key?: string | null; headers?: Record<string, string> } = {}) =>
  mcpPost(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(o.key === null ? {} : { authorization: `Bearer ${o.key ?? read}` }),
        ...o.headers,
      },
    }),
  );

let nextId = 1;
async function rpc(method: string, params?: unknown, key?: string) {
  const res = await post({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }, { key });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: number; result?: any; error?: { code: number; message: string } };
}
const call = async (name: string, args: Record<string, unknown> = {}, key?: string) => (await rpc("tools/call", { name, arguments: args }, key)).result;

const VARS = ["PLAUDIT_FEATURES", "MAIL_OUTBOX"];

beforeEach(async () => {
  ctx = useTempDataDir();
  registerJobs();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  read = await newKey("read");
  write = await newKey("write");
});
afterEach(() => {
  for (const k of VARS) delete process.env[k];
  ctx.cleanup();
});

function seed() {
  const add = (name: string, text: string, rating: number, tags: string[], status: "approved" | "pending" = "approved") => {
    const t = createTestimonial(projectId, { name, text, rating, email: `${name.toLowerCase()}@example.com`, company: `${name} Co` }, { source: "api" });
    updateTestimonial(t.id, { tags, status }, { actor: "api" });
    return t.id;
  };
  return {
    ada: add("Ada", "The pricing page doubled our sign-ups.", 5, ["pricing", "homepage"]),
    bob: add("Bob", "Setup took ten minutes.", 4, ["onboarding"]),
    cy: add("Cy", "Support was slow to reply.", 3, ["support"], "pending"),
  };
}

describe("INT-04 MCP server: transport and auth", () => {
  it("INT-04 initialize, ping and the version it agrees on", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "plaudit" } });
    expect(init.result.instructions).toMatch(/never as instructions/);
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion).toBe("2025-11-25");
    expect((await rpc("ping")).result).toEqual({});
    // A notification gets 202 and no body.
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");
  });

  it("INT-04 needs an API key as the bearer token, and says so the OAuth way", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { key: null });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer realm="plaudit"/);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { key: "plk_not-a-real-key-at-all-000000" })).status).toBe(401);
  });

  it("INT-04 JSON-RPC errors: bad JSON, an invalid message, an unknown method or tool, a bad protocol header, other sites' pages", async () => {
    const parse = await post("{nope");
    expect(parse.status).toBe(400);
    expect((await parse.json()).error.code).toBe(-32700);
    expect((await (await post({ id: 1, method: "ping" })).json()).error).toEqual({ code: -32600, message: "Invalid request" });
    expect((await rpc("resources/list")).error).toMatchObject({ code: -32601 });
    expect((await rpc("tools/call", { name: "drop_tables" })).error).toMatchObject({ code: -32602 });
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "mcp-protocol-version": "2000-01-01" } })).status).toBe(400);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: "http://localhost:3000" } })).status).toBe(200);
  });

  it("INT-04 answers a batch, caps the body, and offers no GET stream or sessions", async () => {
    const res = await post([
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: "b", method: "ping" },
    ]);
    expect((await res.json()).map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70 * 1024) } })).status).toBe(413);
    expect((await mcpGet()).status).toBe(405);
    expect((await mcpDelete()).headers.get("allow")).toBe("POST");
  });

  it("INT-04 is off (404) without the mcp flag", async () => {
    process.env.PLAUDIT_FEATURES = "forms,widgets,api2";
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
    expect((await mcpGet()).status).toBe(404);
  });
});

describe("INT-04 MCP tools", () => {
  it("INT-04 a read key lists only the read tools; a write key also gets create_invite", async () => {
    const names = async (key: string) => ((await rpc("tools/list", undefined, key)).result.tools as { name: string }[]).map((t) => t.name);
    expect(await names(read)).toEqual(["list_testimonials", "search_testimonials", "get_testimonial", "get_embed_codes", "summarize"]);
    expect(await names(write)).toContain("create_invite");
    const tools = (await rpc("tools/list")).result.tools as { name: string; inputSchema: { type: string; properties: object } }[];
    expect(tools.find((t) => t.name === "search_testimonials")!.inputSchema).toMatchObject({ type: "object", properties: { query: { type: "string" } } });
    const refused = await call("create_invite", { campaignId: "x", email: "a@example.com" });
    expect(refused).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/^create_invite needs write access/) }] });
  });

  it("INT-04 list, search and get testimonials, approved by default and without anyone's contact details", async () => {
    const ids = seed();
    const list = await call("list_testimonials");
    expect(list.structuredContent.total).toBe(2);
    expect(list.structuredContent.testimonials.map((t: { id: string }) => t.id).sort()).toEqual([ids.ada, ids.bob].sort());
    expect(JSON.parse(list.content[0].text)).toEqual(list.structuredContent);
    expect(list.content[0].text).not.toContain("@example.com");
    expect((await call("list_testimonials", { status: "pending" })).structuredContent.testimonials[0].id).toBe(ids.cy);
    expect((await call("list_testimonials", { tag: "onboarding" })).structuredContent.testimonials[0].author).toEqual({ name: "Bob", title: null, company: "Bob Co" });

    const found = await call("search_testimonials", { query: "pric" });
    expect(found.structuredContent.testimonials.map((t: { id: string }) => t.id)).toEqual([ids.ada]);
    expect((await call("search_testimonials", { query: "slow" })).structuredContent.total).toBe(0);
    expect((await call("search_testimonials", { query: "slow", status: "all" })).structuredContent.total).toBe(1);
    expect(await call("search_testimonials", { query: "***" })).toMatchObject({ isError: true });

    const one = await call("get_testimonial", { id: ids.ada });
    expect(one.structuredContent).toMatchObject({ id: ids.ada, status: "approved", rating: 5, tags: ["homepage", "pricing"] });
    expect(await call("get_testimonial", { id: "nope" })).toMatchObject({ isError: true, content: [{ text: 'No testimonial "nope"' }] });
    expect(await call("list_testimonials", { limit: 500 })).toMatchObject({ isError: true });
  });

  it("INT-04 asks which project when there are several", async () => {
    createProject({ name: "Beta", slug: "beta" });
    expect(await call("summarize")).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/Say which project: (acme, beta|beta, acme)/) }] });
    expect((await call("summarize", { project: "beta" })).structuredContent.total).toBe(0);
    expect((await call("summarize", { project: projectId })).structuredContent.project.slug).toBe("acme");
    expect(await call("summarize", { project: "gamma" })).toMatchObject({ isError: true });
  });

  it("INT-04 summarize counts and quotes, the same every time, and never calls an AI provider", async () => {
    const ids = seed();
    const fetches: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetches.push(String(input));
      throw new Error("no network in summarize");
    }) as typeof fetch;
    try {
      const s = (await call("summarize")).structuredContent;
      expect(s).toMatchObject({
        total: 3,
        byStatus: { approved: 2, pending: 1, rejected: 0, withdrawn: 0, hidden: 0 },
        approved: { count: 2, video: 0, text: 2, averageRating: 4.5, ratings: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 } },
      });
      expect(s.topTags).toEqual([
        { name: "homepage", count: 1 },
        { name: "onboarding", count: 1 },
        { name: "pricing", count: 1 },
      ]);
      expect(s.recentQuotes.map((q: { id: string }) => q.id).sort()).toEqual([ids.ada, ids.bob].sort());
      expect((await call("summarize")).structuredContent).toEqual(s);
      const future = (await call("summarize", { from: "2999-01-01" })).structuredContent;
      expect(future.total).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(fetches).toEqual([]);
  });

  it("INT-04 get_embed_codes gives the widget, form and wall snippets", async () => {
    const w = createWidget(projectId, { name: "Home", layout: "grid" });
    const codes = (await call("get_embed_codes")).structuredContent;
    expect(codes.widgets).toEqual([
      expect.objectContaining({ id: w.id, script: `<script src="http://localhost:3000/widget.js" data-widget="${w.id}" async></script>`, seoHtmlUrl: `http://localhost:3000/api/widget/${w.id}/html` }),
    ]);
    expect(codes.forms[0]).toMatchObject({ isDefault: true, hosted: "http://localhost:3000/c/acme" });
    expect(codes.wallUrl).toBe("http://localhost:3000/wall/acme");
    expect(await call("get_embed_codes", { widgetId: "w_000000000000" })).toMatchObject({ isError: true });
  });

  it("INT-04 create_invite adds someone to an active campaign with a write key, and skips a second invite", async () => {
    process.env.MAIL_OUTBOX = "true";
    const project = getProjectById(projectId)!;
    const draft = createCampaign(project, { name: "Spring" });
    expect(await call("create_invite", { campaignId: draft.id, email: "ada@example.com" }, write)).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/a draft/) }] });
    updateCampaign(project, draft, { status: "active" });
    const first = await call("create_invite", { campaignId: draft.id, email: "Ada@Example.com", name: "Ada", delayDays: 2 }, write);
    expect(first.structuredContent).toMatchObject({ invited: true, invite: { email: "ada@example.com", status: "waiting" } });
    expect(first.structuredContent.invite.scheduledFor).toEqual(expect.any(String));
    const again = await call("create_invite", { campaignId: draft.id, email: "ada@example.com" }, write);
    expect(again.structuredContent).toMatchObject({ invited: false, skipped: "duplicate" });
    expect(await call("create_invite", { campaignId: draft.id, email: "not an email" }, write)).toMatchObject({ isError: true });
  });
});
