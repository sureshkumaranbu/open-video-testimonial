import { notFound } from "next/navigation";
import { listCustomers } from "@/lib/customer-records";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { CustomersList } from "./CustomersList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

/** INBOX-12: everyone who sent this project a testimonial or feedback, or was invited to. */
export default async function CustomersPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  requireFeature("customers");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar trail={[{ href: "/admin", label: "Projects" }, { href: `/admin/projects/${project.id}`, label: project.name }, { label: "Customers" }]} />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="customers" />
        <div className="page-head">
          <div>
            <h1>Customers</h1>
            <p className="muted">One record per person, linked as testimonials arrive from forms, imports and manual adds. Only you and your team see these.</p>
          </div>
        </div>
        <CustomersList projectId={project.id} initial={listCustomers(project.id)} />
      </main>
    </>
  );
}
