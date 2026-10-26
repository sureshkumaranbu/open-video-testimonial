import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Stars, TestimonialGrid } from "@/components/TestimonialCard";
import { WallView } from "@/components/WallView";
import { findProjectBySlugOrAlias, withQuery } from "@/lib/projects";
import { listFeed, ratingSummary } from "@/lib/public-feed";
import { jsonLdText, reviewJsonLd } from "@/lib/seo";
import { listPublicTestimonials } from "@/lib/testimonials";
import { accentStyle, parseTheme } from "@/lib/theme";
import { absoluteUrl, getMainWall, wallJsonLd, wallMetadata, wallView } from "@/lib/walls";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ theme?: string; tag?: string; tab?: string } & Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = findProjectBySlugOrAlias((await params).slug)?.project;
  if (!project) return { title: "Not found" };
  const main = getMainWall(project.id);
  if (main) return wallMetadata(main, project, { canonical: `/wall/${project.slug}`, ogImage: `/wall/${project.slug}/${main.slug}/opengraph-image` });
  const title = `What people say about ${project.name}`;
  const description = `Testimonials and reviews from ${project.name}'s customers.`;
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(`/wall/${project.slug}`) },
    openGraph: { type: "website", title, description, url: absoluteUrl(`/wall/${project.slug}`), siteName: project.name },
  };
}

/**
 * Public "wall of love": every approved testimonial for a project. Once a
 * published wall is marked main it's shown here instead (WALL-01); until
 * then the page is the legacy one, plus JSON-LD (SEO-03) and meta.
 */
export default async function WallPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const { theme, tag } = query;
  const found = findProjectBySlugOrAlias(slug);
  if (!found) notFound();
  if (!found.canonical) permanentRedirect(withQuery(`/wall/${found.project.slug}`, query));
  const project = found.project;
  const main = getMainWall(project.id);
  if (main) {
    const path = `/wall/${project.slug}`;
    const tab = typeof query.tab === "string" ? query.tab : undefined;
    return <WallView data={wallView(main, project, { tab, path })} jsonLd={wallJsonLd(main, project, absoluteUrl(path))} />;
  }
  const items = listPublicTestimonials(project.id, { tag: tag?.toLowerCase() });
  const rated = items.filter((t) => t.rating);
  const average = rated.length ? rated.reduce((sum, t) => sum + (t.rating ?? 0), 0) / rated.length : 0;

  const jsonLd = reviewJsonLd({
    type: "Product",
    name: project.name,
    url: absoluteUrl(`/wall/${project.slug}`),
    items: listFeed(project.id, {}, { limit: 30 }),
    aggregate: ratingSummary(project.id, {}),
  });

  return (
    <div className="wall-page" data-theme={parseTheme(theme)} style={accentStyle(project.accentColor)}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(jsonLd) }} />
      <main className="container">
        <header className="wall-head">
          <div>
            <h1>What people say about {project.name}</h1>
            <div className="wall-meta">
              {rated.length > 0 && (
                <>
                  <Stars rating={Math.round(average)} label={`Average rating ${average.toFixed(1)} out of 5`} />
                  <strong style={{ color: "var(--ink)" }}>{average.toFixed(1)}</strong>
                  <span aria-hidden>·</span>
                </>
              )}
              <span>
                {items.length} {items.length === 1 ? "testimonial" : "testimonials"}
              </span>
            </div>
          </div>
          <Link className="button accent lg" href={`/c/${project.slug}`}>
            Share your own
          </Link>
        </header>
        <TestimonialGrid items={items} />
      </main>
    </div>
  );
}
