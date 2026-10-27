import { CORS_HEADERS } from "@/lib/http";
import { getSnippet, SNIPPET_ID, snippetScript } from "@/lib/seo-snippets";
import { getProjectById } from "@/lib/testimonials";

const JS_HEADERS = {
  ...CORS_HEADERS,
  "Content-Type": "text/javascript; charset=utf-8",
  "Cache-Control": "public, max-age=300",
};

/**
 * SEO-01 "dynamic" snippet: `<script src="/schema/s_….js">` adds the latest
 * review data to the owner's page. An unknown or deleted snippet is a
 * harmless comment, so a stale tag never breaks the page.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const id = file.endsWith(".js") ? file.slice(0, -3) : "";
  const s = SNIPPET_ID.test(id) ? getSnippet(id) : null;
  const project = s && getProjectById(s.projectId);
  if (!s || !project) return new Response("/* Plaudit: review data not found */\n", { status: 404, headers: JS_HEADERS });
  return new Response(snippetScript(s, project), { headers: JS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
