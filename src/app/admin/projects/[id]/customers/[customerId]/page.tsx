import { notFound } from "next/navigation";
import { customerProfile } from "@/lib/customer-records";
import { emailEnabled } from "@/lib/email";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../../AppBar";
import { ProjectTabs } from "../../ProjectTabs";
import { CustomerProfileView } from "./CustomerProfile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

/** INBOX-12: one person's testimonials, feedback, invitations and rewards, with ways to ask them for more. */
export default async function CustomerPage({ params }: { params: Promise<{ id: string; customerId: string }> }) {
  await requireAdminPage();
  requireFeature("customers");
  const { id, customerId } = await params;
  const project = getProjectById(id);
  if (!project) notFound();
  const profile = customerProfile(project, customerId);
  if (!profile) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { href: `/admin/projects/${project.id}/customers`, label: "Customers" },
          { label: profile.customer.name },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="customers" />
        <CustomerProfileView projectId={project.id} initial={JSON.parse(JSON.stringify(profile))} emailOn={emailEnabled()} />
      </main>
    </>
  );
}
