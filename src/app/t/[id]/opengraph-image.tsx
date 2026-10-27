import { featureOn } from "@/lib/features";
import { shareDesignSchema } from "@/lib/share/design";
import { renderPng } from "@/lib/share/render";
import { testimonialPage } from "@/lib/testimonial-page";

/**
 * WALL-04 link preview: the quote as an image, drawn with next/og like the
 * wall's (D22) by the image studio's own Spotlight template, with the
 * project's logo. A testimonial without a public page answers 404, exactly
 * like an id that never existed.
 */

export const dynamic = "force-dynamic";
export const alt = "A testimonial";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const d = featureOn("walls") ? testimonialPage((await params).id) : null;
  if (!d) return notFound();
  const design = shareDesignSchema.parse({
    template: "spotlight",
    size: { preset: "custom", ...size },
    logo: { source: d.project.logoKey ? "brand" : "none", position: "top-left", size: 56 },
  });
  let png: Uint8Array;
  try {
    png = await renderPng({ design, items: [{ id: d.item.id }] }, { project: { id: d.project.id, accentColor: d.project.accentColor, logoKey: d.project.logoKey }, publicOnly: true });
  } catch {
    return notFound();
  }
  // Revalidated on every fetch, so a testimonial taken down leaves the image at once (like /api/media).
  return new Response(Buffer.from(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, no-cache" } });
}
