import { notFound } from "next/navigation";
import { TestimonialGrid } from "@/components/TestimonialCard";
import { getProjectBySlug, listPublicTestimonials } from "@/lib/testimonials";
import { parseTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ theme?: string; tag?: string; limit?: string }>;
};

// Tells the parent page how tall the content is so the iframe can grow to fit.
const RESIZE_SCRIPT = `(function(){
  var root = document.getElementById("plaudit-embed");
  var send = function(){
    parent.postMessage({ type: "plaudit:resize", slug: root.dataset.slug, height: Math.ceil(root.getBoundingClientRect().height) }, "*");
  };
  new ResizeObserver(send).observe(root);
  window.addEventListener("load", send);
})();`;

/** Iframe-embeddable grid of approved testimonials. */
export default async function EmbedPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { theme, tag, limit } = await searchParams;
  const project = getProjectBySlug(slug);
  if (!project) notFound();
  const n = Number(limit);
  const items = listPublicTestimonials(project.id, {
    tag: tag?.toLowerCase(),
    limit: Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 50,
  });

  return (
    <div
      id="plaudit-embed"
      data-theme={parseTheme(theme)}
      data-slug={project.slug}
      className="embed-body"
      style={{ ["--accent" as string]: project.accentColor }}
    >
      <style>{`html,body{background:transparent!important;margin:0}`}</style>
      <div className="container">
        <TestimonialGrid items={items} />
      </div>
      <script dangerouslySetInnerHTML={{ __html: RESIZE_SCRIPT }} />
    </div>
  );
}
