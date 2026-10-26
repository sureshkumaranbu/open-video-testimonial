import { getWall, wallConfig, wallItems, wallTabs } from "@/lib/walls";

/**
 * WALL-01 "load more": the next page of one tab of a published wall. A draft
 * or unknown wall is a 404, so nothing about it leaks before it's live.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const wall = getWall((await ctx.params).id);
  if (!wall || !wall.published) return Response.json({ error: "Wall not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const q = new URL(req.url).searchParams;
  const cfg = wallConfig(wall);
  const tab = Math.min(Math.max(0, Number.parseInt(q.get("tab") ?? "0", 10) || 0), wallTabs(cfg).length - 1);
  const offset = Math.min(Math.max(0, Number.parseInt(q.get("offset") ?? "0", 10) || 0), 100_000);
  return Response.json(wallItems(wall, { tab, offset, config: cfg }), {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
