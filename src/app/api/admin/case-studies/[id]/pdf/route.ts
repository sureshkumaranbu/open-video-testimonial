import { caseStudyView, getCaseStudy } from "@/lib/case-studies";
import { caseStudyPdf, pdfFileName } from "@/lib/case-study-pdf";
import { jsonError, requireRole } from "@/lib/http";

/** SHARE-04: the PDF for the team, draft or published (the public one is /cs/<id>/pdf). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireRole(req, "viewer");
  if (denied) return denied;
  const cs = getCaseStudy((await ctx.params).id);
  const view = cs ? caseStudyView(cs) : null;
  if (!view) return jsonError(404, "Case study not found");
  const pdf = await caseStudyPdf(view);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(view.title)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
