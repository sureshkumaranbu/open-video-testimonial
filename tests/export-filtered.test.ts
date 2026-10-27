import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as exportGet, POST as exportPost } from "@/app/api/admin/projects/[id]/export/route";
import { getDb, schema } from "@/db";
import { parseCsv } from "@/lib/csv";
import { DEFAULT_QUERY } from "@/lib/inbox";
import { inboxExport } from "@/lib/inbox-export";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { trashTestimonial } from "@/lib/trash";
import { adminHeaders, params, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let ids: string[];

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  ids = [
    createTestimonial(projectId, { name: "Ann", text: "Great", rating: 5, customFields: { nps: 9, plan: "Enterprise" }, hiddenFields: { utm_source: "news" } }, { createdAt: new Date("2026-10-01") }).id,
    createTestimonial(projectId, { name: "Ben", text: "Good", rating: 4, customFields: { nps: 7 } }, { createdAt: new Date("2026-10-02") }).id,
    createTestimonial(projectId, { name: "Cat", text: "Poor", rating: 2 }, { createdAt: new Date("2026-10-03") }).id,
  ];
  updateTestimonial(ids[0], { tags: ["pricing"] });
  trashTestimonial(ids[2]);
  createTestimonial(createProject({ name: "Other", slug: "other" }).id, { name: "Zed", text: "x" });
});
afterEach(() => ctx.cleanup());

const text = (s: ReadableStream<Uint8Array>) => new Response(s).text();
const get = (qs: string) =>
  exportGet(new Request(`http://localhost/api/admin/projects/${projectId}/export?${qs}`, { headers: adminHeaders() }), params({ id: projectId }));

describe("INBOX-15 filtered export", () => {
  it("INBOX-15 CSV of the view has custom:* and hidden:* columns, in the view's order", async () => {
    const rows = parseCsv(await text(inboxExport(projectId, { ...DEFAULT_QUERY, tab: "all", sort: "name", dir: "asc" }, "csv")));
    const [head, ...body] = rows;
    expect(head).toEqual(expect.arrayContaining(["id", "name", "email", "custom:nps", "custom:plan", "hidden:utm_source"]));
    const col = (name: string) => head.indexOf(name);
    expect(body.map((r) => r[col("name")])).toEqual(["Ann", "Ben"]);
    expect(body[0][col("custom:nps")]).toBe("9");
    expect(body[0][col("custom:plan")]).toBe("Enterprise");
    expect(body[0][col("hidden:utm_source")]).toBe("news");
    expect(body[1][col("custom:plan")]).toBe("");
  });

  it("INBOX-15 JSON of the view, and the selected ids only", async () => {
    const all = JSON.parse(await text(inboxExport(projectId, { ...DEFAULT_QUERY, tab: "trash" }, "json")));
    expect(all.map((t: { author: { name: string } }) => t.author.name)).toEqual(["Cat"]);
    const picked = JSON.parse(await text(inboxExport(projectId, { ...DEFAULT_QUERY, ids: [ids[1], "nope", ids[0]] }, "json")));
    expect(picked.map((t: { id: string }) => t.id)).toEqual([ids[1], ids[0]]);
    expect(picked[1].customFields).toEqual({ nps: 9, plan: "Enterprise" });
    expect(JSON.parse(await text(inboxExport(projectId, { ...DEFAULT_QUERY, q: "nothingmatches" }, "json")))).toEqual([]);
  });

  it("INBOX-15 the export route takes the inbox query and ids=, and keeps the old CSV and zip", async () => {
    const filtered = await get("format=csv&tab=all&rating=5");
    expect(filtered.headers.get("content-type")).toContain("text/csv");
    expect(filtered.headers.get("content-disposition")).toContain("testimonials");
    const rows = parseCsv(await filtered.text());
    expect(rows.slice(1).map((r) => r[rows[0].indexOf("name")])).toEqual(["Ann"]);

    // A bare JSON export is the whole inbox except the trash.
    const bare = await (await get("format=json")).json();
    expect(bare.map((t: { id: string }) => t.id).sort()).toEqual([ids[0], ids[1]].sort());

    const selected = await get(`format=json&ids=${ids[1]}`);
    expect((await selected.json()).map((t: { id: string }) => t.id)).toEqual([ids[1]]);

    // Plain ?format=csv is still every testimonial of the project, the trashed one included.
    const legacy = parseCsv(await (await get("format=csv")).text());
    expect(legacy.slice(1)).toHaveLength(3);
    expect((await get("")).headers.get("content-type")).toBe("application/zip");

    const posted = await exportPost(
      new Request(`http://localhost/x`, {
        method: "POST",
        headers: { ...adminHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ format: "csv", ids: [ids[0], ids[2]] }),
      }),
      params({ id: projectId }),
    );
    const postedRows = parseCsv(await posted.text());
    expect(postedRows.slice(1).map((r) => r[0])).toEqual([ids[0], ids[2]]);
  });

  it("INBOX-15 an export with no rows still has its header", async () => {
    getDb().delete(schema.testimonials).where(eq(schema.testimonials.projectId, projectId)).run();
    const rows = parseCsv(await text(inboxExport(projectId, { ...DEFAULT_QUERY, tab: "all" }, "csv")));
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("id");
  });
});
