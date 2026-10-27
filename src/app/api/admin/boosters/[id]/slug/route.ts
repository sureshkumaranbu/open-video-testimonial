import { z } from "zod";
import { boosterToAdmin, changeBoosterSlug } from "@/lib/boosters";
import { jsonError, requireAdmin } from "@/lib/http";
import { firstIssue } from "@/lib/validation";
import { boosterAndProject, boosterError } from "../guard";

const body = z.object({ slug: z.string().max(48) });

/** A new link for the page. The old one answers 308, so printed QR codes keep working. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const found = boosterAndProject((await ctx.params).id);
  if (!found) return jsonError(404, "Booster not found");
  try {
    const { booster, droppedAlias } = changeBoosterSlug(found.booster.id, parsed.data.slug);
    return Response.json({ booster: boosterToAdmin(booster, found.project), droppedAlias });
  } catch (err) {
    return boosterError(err);
  }
}
