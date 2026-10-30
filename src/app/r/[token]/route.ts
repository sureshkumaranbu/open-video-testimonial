import { getForm } from "@/lib/forms";
import { findRequestByToken, markClicked, requestLink } from "@/lib/requests";
import { getProjectById } from "@/lib/testimonials";

/** Like the other email links' "Link not found" pages (/u, /d, /w), readable on a phone. */
const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Link not found · Plaudit</title><style>body{margin:0;background:#f6f7f9;color:#161b2e;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.55}main{max-width:560px;margin:0 auto;padding:64px 16px}h1{font-size:1.75rem;margin:0 0 8px}p{color:#545c70;margin:0}</style></head><body><main><h1>Link not found</h1><p>This link isn&#39;t valid. Check that you copied all of it.</p></main></body></html>`;

/**
 * The personal link in campaign emails (M9, REQ-04): records the first click,
 * then sends the person on to their own form link. The target is always built
 * from the request itself, never from the URL, so this can't redirect anywhere else.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const r = findRequestByToken((await ctx.params).token);
  const project = r ? getProjectById(r.projectId) : null;
  if (!r || !project) {
    return new Response(NOT_FOUND, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
    });
  }
  markClicked(r);
  const form = r.formId ? getForm(r.formId) : null;
  const target = requestLink(project, r.id, form && form.projectId === project.id ? form : null);
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
