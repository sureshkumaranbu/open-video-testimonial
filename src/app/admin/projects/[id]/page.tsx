import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { LogoutButton } from "../../AdminForms";
import { Dashboard } from "./Dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const project = getProjectById((await params).id);
  if (!project) notFound();

  return (
    <main className="container stack">
      <div className="topbar">
        <Link href="/admin" className="brand">
          ← Plaudit
        </Link>
        <LogoutButton />
      </div>
      <Dashboard project={project} publicUrl={env.publicUrl} />
    </main>
  );
}
