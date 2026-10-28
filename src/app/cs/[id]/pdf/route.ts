import { publicCaseStudy } from "@/lib/case-studies";
import { caseStudyPdf, pdfFileName } from "@/lib/case-study-pdf";
import { featureOn } from "@/lib/features";

/**
 * SHARE-04: a published case study's PDF. The same rules as its page: the
 * `insights` flag on, published, and the testimonial public (approved, not
 * withdrawn, public consent); anything else is the same 404 as an unknown id.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const view = featureOn("insights") ? publicCaseStudy((await ctx.params).id) : null;
  if (!view) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const pdf = await caseStudyPdf(view);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfFileName(view.title)}"`,
      // Unpublishing, a withdrawal or a rejection takes effect at once.
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
