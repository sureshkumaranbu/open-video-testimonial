import { notFound, permanentRedirect } from "next/navigation";
import { TestimonialGrid } from "@/components/TestimonialCard";
import { findProjectBySlugOrAlias, withQuery } from "@/lib/projects";
import { listPublicTestimonials } from "@/lib/testimonials";
import { accentStyle, parseTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  /** `as`: the old slug an embed code was written with (set by the redirect from it). */
  searchParams: Promise<{ theme?: string; tag?: string; limit?: string; as?: string } & Record<string, string | string[] | undefined>>;
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
  const query = await searchParams;
  const { theme, tag, limit } = query;
  const found = findProjectBySlugOrAlias(slug);
  if (!found) notFound();
  // An old slug moves on to the new one (D17). Its embed code listens for
  // resize messages naming the old slug, so the frame keeps posting that one.
  if (!found.canonical) permanentRedirect(withQuery(`/embed/${found.project.slug}`, { ...query, as: slug }));
  const project = found.project;
  // ?as= counts only while it's still one of this project's old slugs.
  const old = typeof query.as === "string" ? findProjectBySlugOrAlias(query.as) : null;
  const messageSlug = old && !old.canonical && old.project.id === project.id ? (query.as as string) : project.slug;
  const n = Number(limit);
  const items = listPublicTestimonials(project.id, {
    tag: tag?.toLowerCase(),
    limit: Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 50,
  });

  return (
    <div
      id="plaudit-embed"
      data-theme={parseTheme(theme)}
      data-slug={messageSlug}
      className="embed-body"
      style={accentStyle(project.accentColor)}
    >
      <style>{`html,body{background:transparent!important;margin:0}`}</style>
      <div className="container">
        <TestimonialGrid items={items} />
      </div>
      <script dangerouslySetInnerHTML={{ __html: RESIZE_SCRIPT }} />
    </div>
  );
}
