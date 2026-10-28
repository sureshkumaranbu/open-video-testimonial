import { env } from "@/lib/env";
import { jsonError, requireRole } from "@/lib/http";
import { deleteSnippet, getSnippet, SnippetError, snippetPatchBody, snippetToAdmin, updateSnippet } from "@/lib/seo-snippets";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

function view(id: string) {
  const s = getSnippet(id);
  const project = s && getProjectById(s.projectId);
  return s && project ? snippetToAdmin(s, project, env.publicUrl) : null;
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const snippet = view((await ctx.params).id);
  if (!snippet) return jsonError(404, "Snippet not found");
  return Response.json({ snippet });
}

/** Name, schema type, scope and the reviewed item. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const parsed = snippetPatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  const { id } = await ctx.params;
  try {
    if (!updateSnippet(id, parsed.data)) return jsonError(404, "Snippet not found");
    return Response.json({ snippet: view(id) });
  } catch (err) {
    if (err instanceof SnippetError) return jsonError(err.status, err.message);
    throw err;
  }
}

/** Pages that still load its script get an empty comment instead. */
export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  if (!deleteSnippet((await ctx.params).id)) return jsonError(404, "Snippet not found");
  return Response.json({ ok: true });
}
