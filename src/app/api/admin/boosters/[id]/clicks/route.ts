import { clickStats } from "@/lib/boosters";
import { jsonError, requireAdmin } from "@/lib/http";
import { boosterAndProject } from "../guard";

/** BOOST-05: daily clicks per link for the last 7, 30 or 90 days (`?days=`). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const found = boosterAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Booster not found");
  const asked = Number(new URL(req.url).searchParams.get("days"));
  const days = [7, 30, 90].includes(asked) ? asked : 30;
  return Response.json({ stats: clickStats(found.booster, days) });
}
