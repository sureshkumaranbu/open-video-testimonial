import { notFound } from "next/navigation";
import { ObjectAnalytics } from "@/components/analytics/ObjectAnalytics";
import { analyticsUi } from "@/lib/analytics";
import { env } from "@/lib/env";
import { featureOn, requireFeature } from "@/lib/features";
import { translationProviderName } from "@/lib/translate";
import { getForm } from "@/lib/forms";
import { formToAdmin } from "@/lib/forms/admin";
import { parseBrand } from "@/lib/projects";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../../AppBar";
import { ProjectTabs } from "../../ProjectTabs";
import { Builder, type BuilderTab } from "./Builder";

export const dynamic = "force-dynamic";
export const metadata = { title: "Form builder" };

const TABS: BuilderTab[] = ["content", "design", "settings", "share"];

/** FORM-02: the builder: pages on the left, a live preview in the middle, the selected page's settings on the right. */
export default async function FormBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; formId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdminPage();
  requireFeature("forms");
  const { id, formId } = await params;
  const project = getProjectById(id);
  const form = getForm(formId);
  if (!project || !form || form.projectId !== project.id) notFound();
  const tab = (await searchParams).tab;
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { href: `/admin/projects/${project.id}/forms`, label: "Forms" },
          { label: form.name },
        ]}
      />
      <main className="container stack-lg fb-main">
        <ProjectTabs projectId={project.id} active="forms" />
        <Builder
          project={{
            id: project.id,
            slug: project.slug,
            name: project.name,
            accentColor: project.accentColor,
            brand: parseBrand(project.brand),
            logoUrl: project.logoKey ? `/api/media/${project.logoKey}` : null,
            translations: featureOn("translations") ? { provider: translationProviderName() } : undefined,
            video2: featureOn("video2"),
          }}
          initial={JSON.parse(JSON.stringify(formToAdmin(project, form)))}
          limits={{ maxVideoBytes: env.maxVideoBytes, maxImageBytes: env.maxImageBytes }}
          initialTab={TABS.includes(tab as BuilderTab) ? (tab as BuilderTab) : "content"}
        />
        {analyticsUi() && (
          <div className="panel panel-body">
            <ObjectAnalytics type="form" id={form.id} />
          </div>
        )}
      </main>
    </>
  );
}
