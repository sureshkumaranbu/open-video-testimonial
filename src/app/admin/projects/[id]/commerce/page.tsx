import { notFound } from "next/navigation";
import { roleAtLeast } from "@/lib/access";
import { requireFeature } from "@/lib/features";
import { requireAdminPage } from "@/lib/server-session";
import { getProjectById } from "@/lib/testimonials";
import { AppBar } from "../../../AppBar";
import { ProjectTabs } from "../ProjectTabs";
import { Commerce } from "./Commerce";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commerce" };

/** INT-07: the project's Stripe connection, the purchases it recorded, and where they're used. */
export default async function CommercePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPage();
  requireFeature("commerce");
  const project = getProjectById((await params).id);
  if (!project) notFound();
  return (
    <>
      <AppBar
        trail={[
          { href: "/admin", label: "Projects" },
          { href: `/admin/projects/${project.id}`, label: project.name },
          { label: "Commerce" },
        ]}
      />
      <main className="container stack-lg">
        <ProjectTabs projectId={project.id} active="commerce" />
        <div className="page-head">
          <div>
            <h1>Commerce</h1>
            <p className="muted">
              Connect Stripe to show recent purchases in a sales popup, mark testimonials from buyers as &ldquo;Verified purchase&rdquo;, and give each person who
              sends a form their own thank-you coupon.
            </p>
          </div>
        </div>
        <Commerce projectId={project.id} admin={roleAtLeast(session.role, "admin")} />
      </main>
    </>
  );
}
