import { z } from "zod";
import { jsonError, requireRole } from "@/lib/http";
import { projectOr404, shareFail } from "@/lib/share/http";
import { createShareTemplate, listShareTemplates, templateToAdmin } from "@/lib/share/store";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ name: z.string().trim().min(1, "Give the template a name").max(80), design: z.record(z.string(), z.unknown()) });

/** SHARE-02: the project's saved studio templates. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const found = projectOr404((await ctx.params).id);
  if ("response" in found) return found.response;
  return Response.json({ templates: listShareTemplates(found.project.id).map(templateToAdmin) });
}

/** SHARE-02: "Save as my template": `{name, design}`, no testimonial content. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const found = projectOr404((await ctx.params).id);
  if ("response" in found) return found.response;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    return Response.json({ template: templateToAdmin(createShareTemplate(found.project.id, parsed.data.name, parsed.data.design)) }, { status: 201 });
  } catch (err) {
    return shareFail(err);
  }
}
