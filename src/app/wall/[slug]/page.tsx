import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Stars, TestimonialGrid } from "@/components/TestimonialCard";
import { findProjectBySlugOrAlias, withQuery } from "@/lib/projects";
import { listPublicTestimonials } from "@/lib/testimonials";
import { accentStyle, parseTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ theme?: string; tag?: string } & Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = findProjectBySlugOrAlias((await params).slug)?.project;
  return { title: project ? `What people say about ${project.name}` : "Not found" };
}

/** Public "wall of love": every approved testimonial for a project. */
export default async function WallPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const { theme, tag } = query;
  const found = findProjectBySlugOrAlias(slug);
  if (!found) notFound();
  if (!found.canonical) permanentRedirect(withQuery(`/wall/${found.project.slug}`, query));
  const project = found.project;
  const items = listPublicTestimonials(project.id, { tag: tag?.toLowerCase() });
  const rated = items.filter((t) => t.rating);
  const average = rated.length ? rated.reduce((sum, t) => sum + (t.rating ?? 0), 0) / rated.length : 0;

  return (
    <div className="wall-page" data-theme={parseTheme(theme)} style={accentStyle(project.accentColor)}>
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
