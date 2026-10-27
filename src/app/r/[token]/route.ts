import { getForm } from "@/lib/forms";
import { findRequestByToken, markClicked, requestLink } from "@/lib/requests";
import { getProjectById } from "@/lib/testimonials";

/**
 * The personal link in campaign emails (M9, REQ-04): records the first click,
 * then sends the person on to their own form link. The target is always built
 * from the request itself, never from the URL, so this can't redirect anywhere else.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const r = findRequestByToken((await ctx.params).token);
  const project = r ? getProjectById(r.projectId) : null;
  if (!r || !project) {
    return new Response("This link isn't valid. Check that you copied all of it.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  markClicked(r);
  const form = r.formId ? getForm(r.formId) : null;
  const target = requestLink(project, r.id, form && form.projectId === project.id ? form : null);
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
