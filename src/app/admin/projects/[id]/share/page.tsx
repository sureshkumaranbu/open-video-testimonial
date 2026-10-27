import { and, desc, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { featureOn, requireFeature } from "@/lib/features";
import { parseBrand } from "@/lib/projects";
import { availableFonts } from "@/lib/share/render";
import { assetToAdmin, listAssets, listShareTemplates, templateToAdmin } from "@/lib/share/store";
import { requireAdminPage } from "@/lib/server-session";
import { mediaUrl } from "@/lib/storage";
import { hasPublicPage } from "@/lib/testimonial-page";
import { getProjectById } from "@/lib/testimonials";
import { getMainWall, wallPath } from "@/lib/walls";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { Studio, type StudioTestimonial } from "./Studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Image studio" };

/** How many recent testimonials the picker lists (approved ones first). */
const PICKER_LIMIT = 300;

/** SHARE-01..03: the image studio, behind the share flag (D20). `?ids=a,b` starts with those testimonials. */
export default async function SharePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ids?: string }> }) {
  await requireAdminPage();
  requireFeature("share");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  const { testimonials } = schema;
  const rows = getDb()
    .select()
    .from(testimonials)
    .where(and(eq(testimonials.projectId, project.id), ne(testimonials.status, "trashed")))
    .orderBy(desc(testimonials.createdAt))
    .limit(PICKER_LIMIT)
    .all()
    .sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved"));
  const pages = featureOn("walls");
  const list: StudioTestimonial[] = rows.map((t) => ({
    id: t.id,
    name: t.authorName,
    status: t.status,
    rating: t.rating,
    excerpt: (t.headline || t.text || t.transcript || (t.videoKey ? "(video without a transcript)" : "")).slice(0, 160),
    pageUrl: pages && hasPublicPage(t) ? `${env.publicUrl}/t/${t.id}` : null,
  }));
  const ids = (await searchParams).ids?.split(",").filter((id) => list.some((t) => t.id === id)).slice(0, 6) ?? [];
  const main = getMainWall(project.id);
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Image studio" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="share" />
        <Studio
          project={{ id: project.id, name: project.name, accentColor: project.accentColor, logoUrl: mediaUrl(project.logoKey), brand: parseBrand(project.brand) }}
          testimonials={list}
          initialIds={ids}
          fonts={availableFonts()}
          initialTemplates={listShareTemplates(project.id).map(templateToAdmin)}
          initialAssets={listAssets(project.id).map(assetToAdmin)}
          wallUrl={`${env.publicUrl}${main ? wallPath(project, main) : `/wall/${project.slug}`}`}
        />
      </main>
    </>
  );
}
