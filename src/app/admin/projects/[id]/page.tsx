import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireAdminPage } from "@/lib/server-session";
import { systemStatus } from "@/lib/system";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../AppBar";
import { Dashboard } from "./Dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const project = getProjectById((await params).id);
  if (!project) notFound();

  return (
    <>
      <AppBar trail={[{ href: "/admin", label: "Projects" }, { label: project.name }]} />
      <main className="container">
        <Dashboard project={project} publicUrl={env.publicUrl} system={await systemStatus()} />
      </main>
    </>
  );
}
