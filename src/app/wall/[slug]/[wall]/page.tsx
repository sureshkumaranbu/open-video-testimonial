import type { Metadata } from "next";
import { featureOn } from "@/lib/features";
import { notFound, permanentRedirect } from "next/navigation";
import { WallView } from "@/components/WallView";
import { env } from "@/lib/env";
import { findProjectBySlugOrAlias, withQuery } from "@/lib/projects";
import { absoluteUrl, getWallBySlug, wallJsonLd, wallMetadata, wallPath, wallView } from "@/lib/walls";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string; wall: string }>;
  searchParams: Promise<{ tab?: string } & Record<string, string | string[] | undefined>>;
};

/** A published wall, following old project and wall links. Drafts are null (so 404). */
function resolve(slug: string, wallSlug: string) {
  // B-04: with the walls flag off, named walls are a 404 like /t/.
  if (!featureOn("walls")) return null;
  const found = findProjectBySlugOrAlias(slug);
  if (!found) return null;
  const hit = getWallBySlug(found.project.id, wallSlug);
  if (!hit || !hit.wall.published) return null;
  return { project: found.project, wall: hit.wall, moved: !found.canonical || Boolean(hit.redirectedFrom) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, wall } = await params;
  const r = resolve(slug, wall);
  if (!r) return { metadataBase: new URL(env.publicUrl), title: "Not found", robots: { index: false } };
  const own = `/wall/${r.project.slug}/${r.wall.slug}`;
  return wallMetadata(r.wall, r.project, { canonical: wallPath(r.project, r.wall), ogImage: `${own}/opengraph-image` });
}

/** WALL-01..03: one of the project's walls. Old links answer 308 with the query kept (D17). */
export default async function WallSlugPage({ params, searchParams }: Props) {
  const { slug, wall: wallSlug } = await params;
  const query = await searchParams;
  const r = resolve(slug, wallSlug);
  if (!r) notFound();
  const { project, wall } = r;
  const own = `/wall/${project.slug}/${wall.slug}`;
  if (r.moved) permanentRedirect(withQuery(own, query));
  const data = wallView(wall, project, { tab: query.tab, path: own });
  return <WallView data={data} jsonLd={wallJsonLd(wall, project, absoluteUrl(wallPath(project, wall)))} />;
}
