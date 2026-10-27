import { notFound } from "next/navigation";
import { emailMode } from "@/lib/email";
import { env } from "@/lib/env";
import { featureOn } from "@/lib/features";
import { DEFAULT_INVITE_MESSAGE, DEFAULT_INVITE_SUBJECT } from "@/lib/requests";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { Requests } from "./Requests";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests" };

export default async function RequestsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const project = getProjectById((await params).id);
  if (!project) notFound();
  const mode = emailMode();
  return (
    <>
      <AppBar trail={[{ href: "/admin", label: "Projects" }, { href: `/admin/projects/${project.id}`, label: project.name }, { label: "Requests" }]} />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="requests" />
        <Requests
          project={project}
          email={{ mode, from: mode === "off" ? null : env.smtpFrom }}
          defaults={{ subject: DEFAULT_INVITE_SUBJECT, message: DEFAULT_INVITE_MESSAGE }}
          campaignsHref={featureOn("campaigns") ? `/admin/projects/${project.id}/campaigns` : null}
        />
      </main>
    </>
  );
}
