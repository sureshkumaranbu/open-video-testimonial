import { env } from "@/lib/env";
import { jsonError, requireRole } from "@/lib/http";
import { createSnippet, createSnippetBody, listSnippets, SnippetError, snippetToAdmin } from "@/lib/seo-snippets";
import { getProjectById } from "@/lib/testimonials";
import { firstIssue } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** SEO-01: the project's review snippets with their code and guidance. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  return Response.json({ snippets: listSnippets(project.id).map((s) => snippetToAdmin(s, project, env.publicUrl)) });
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = requireRole(req, "editor");
  if (denied) return denied;
  const project = getProjectById((await ctx.params).id);
  if (!project) return jsonError(404, "Project not found");
  const parsed = createSnippetBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
  try {
    const s = createSnippet(project, parsed.data);
    return Response.json({ snippet: snippetToAdmin(s, project, env.publicUrl) }, { status: 201 });
  } catch (err) {
    if (err instanceof SnippetError) return jsonError(err.status, err.message);
    throw err;
  }
}
