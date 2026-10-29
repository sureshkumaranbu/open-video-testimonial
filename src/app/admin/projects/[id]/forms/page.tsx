import { notFound } from "next/navigation";
import { aiForProject } from "@/lib/ai";
import { featureOn, requireFeature } from "@/lib/features";
import { listForms } from "@/lib/forms";
import { formToAdmin } from "@/lib/forms/admin";
import { FORM_TEMPLATES } from "@/lib/forms/templates";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { FormsList } from "./FormsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forms" };

/** FORM-01: the project's forms, with their stats and a menu for each, and new ones from templates. */
export default async function FormsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("forms");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  const forms = listForms(project.id).map(({ stats, ...f }) => formToAdmin(project, f, stats));
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Forms" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="forms" />
        <div className="page-head">
          <div>
            <h1>Forms</h1>
            <p className="muted">Several forms for one project, each with its own questions, fields, look and rules.</p>
          </div>
        </div>
        <FormsList
          projectId={project.id}
          initial={JSON.parse(JSON.stringify(forms))}
          templates={FORM_TEMPLATES.map(({ id, name, description }) => ({ id, name, description }))}
          surveys={featureOn("insights") ? { ai: aiForProject(project) } : undefined}
        />
      </main>
    </>
  );
}
