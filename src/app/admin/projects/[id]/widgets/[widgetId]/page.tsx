import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireFeature } from "@/lib/features";
import { inboxFacets, parseInboxParams, queryTestimonials } from "@/lib/inbox";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { getLiveWidget, widgetToAdmin } from "@/lib/widgets";
import { AppBar } from "../../../../AppBar";
import { ProjectTabs } from "../../ProjectTabs";
import { Studio, type PickItem, type StudioTab } from "./Studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Widget studio" };

const TABS: StudioTab[] = ["layout", "testimonials", "design", "settings", "labels", "share"];

/** DISP-01..09: the widget studio: settings on the left, the live preview (the real widget.js) on the right. */
export default async function WidgetStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; widgetId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdminPage();
  requireFeature("widgets");
  const { id, widgetId } = await params;
  const project = getProjectById(id);
  const widget = getLiveWidget(widgetId);
  if (!project || !widget || widget.projectId !== project.id) notFound();
  const tab = (await searchParams).tab;
  // What the manual picker offers: the newest approved ones (the picker searches these).
  const approved = queryTestimonials(project.id, parseInboxParams(new URLSearchParams("tab=approved&size=100"))).items;
  const pickable: PickItem[] = approved
    .filter((t) => !t.withdrawnAt)
    .map((t) => ({ id: t.id, name: t.authorName, rating: t.rating, text: (t.headline || t.text || "").slice(0, 140), video: Boolean(t.videoKey) }));
  const facets = inboxFacets(project.id);
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { href: `/admin/projects/${project.id}/widgets`, label: "Widgets" },
          { label: widget.name },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="widgets" />
        <Studio
          project={{ id: project.id, slug: project.slug, name: project.name, accentColor: project.accentColor }}
          initial={JSON.parse(JSON.stringify(widgetToAdmin(widget)))}
          pickable={pickable}
          facets={facets}
          origin={env.publicUrl}
          initialTab={TABS.includes(tab as StudioTab) ? (tab as StudioTab) : "layout"}
        />
      </main>
    </>
  );
}
