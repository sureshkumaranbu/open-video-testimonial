import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TestimonialGrid } from "@/components/TestimonialCard";
import { getProjectBySlug, listPublicTestimonials } from "@/lib/testimonials";
import { parseTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ theme?: string; tag?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = getProjectBySlug((await params).slug);
  return { title: project ? `What people say about ${project.name}` : "Not found" };
}

/** Public "wall of love": every approved testimonial for a project. */
export default async function WallPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { theme, tag } = await searchParams;
  const project = getProjectBySlug(slug);
  if (!project) notFound();
  const items = listPublicTestimonials(project.id, { tag: tag?.toLowerCase() });

  return (
    <div
      data-theme={parseTheme(theme)}
      style={{ background: "var(--bg)", minHeight: "100vh", ["--accent" as string]: project.accentColor }}
    >
      <main className="container stack">
        <header className="stack" style={{ textAlign: "center", gap: 6 }}>
          <h1 style={{ margin: 0 }}>What people say about {project.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {items.length} {items.length === 1 ? "testimonial" : "testimonials"}
          </p>
          <div>
            <Link className="button" href={`/c/${project.slug}`}>
              Share your own
            </Link>
          </div>
        </header>
        <TestimonialGrid items={items} />
      </main>
    </div>
  );
}
