import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { featureOn } from "@/lib/features";
import { getInboxPrefs, parseInboxParams } from "@/lib/inbox";
import { requireAdminPage } from "@/lib/server-session";
import { systemStatus } from "@/lib/system";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../AppBar";
import { Dashboard } from "./Dashboard";
import { Inbox } from "./inbox/Inbox";
import { ProjectTabs } from "./ProjectTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project" };

type Search = Record<string, string | string[] | undefined>;

function toSearchParams(sp: Search) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) out.append(k, one);
  return out;
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const session = await requireAdminPage();
  const project = getProjectById((await params).id);
  if (!project) notFound();
  const system = await systemStatus();

  // Inbox v2 behind its flag (D20); the classic dashboard otherwise.
  if (!featureOn("inbox2")) {
    return (
      <>
        <AppBar trail={[{ href: "/admin", label: "Projects" }, { label: project.name }]} />
        <main className="container stack-lg">
          <ProjectTabs projectId={project.id} active="testimonials" />
          <Dashboard project={project} publicUrl={env.publicUrl} system={system} />
        </main>
      </>
    );
  }

  // The view comes from the address bar; without a sort or page size, the person's remembered ones.
  const prefs = getInboxPrefs(session.email);
  const sp = await searchParams;
  const query = parseInboxParams(toSearchParams(sp), { sort: prefs.inboxSort, dir: prefs.inboxDir, pageSize: prefs.pageSize });
  const open = typeof sp.open === "string" && /^[\w-]{1,64}$/.test(sp.open) ? sp.open : undefined;
  return (
    <>
      <AppBar trail={[{ href: "/admin", label: "Projects" }, { label: project.name }]} />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="testimonials" />
        <Inbox
          project={project}
          publicUrl={env.publicUrl}
          system={system}
          initialQuery={query}
          initialPrefs={prefs}
          widgetStudio={featureOn("widgets") ? `/admin/projects/${project.id}/widgets` : undefined}
          initialOpenId={open}
        />
      </main>
    </>
  );
}
