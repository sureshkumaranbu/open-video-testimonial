import { emailMode } from "@/lib/email";
import { requireFeature } from "@/lib/features";
import { BUSINESS_LABELS, BUSINESS_TYPES } from "@/lib/onboarding";
import { requireRolePage } from "@/lib/server-session";
import { AppBar } from "../AppBar";
import { Wizard } from "./Wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Get started" };

/** The first-run wizard (ONB-01). Reached from the Get started card; /admin itself never redirects here (D10). */
export default async function WelcomePage() {
  await requireRolePage("admin");
  requireFeature("onboarding");
  return (
    <>
      <AppBar trail={[{ href: "/admin", label: "Projects" }, { label: "Get started" }]} />
      <main className="container stack-lg">
        <div className="page-head">
          <div>
            <h1>Set up your first project</h1>
            <p className="muted">Three questions, then we&apos;ll make your collection form, a Wall of Love and two widgets.</p>
          </div>
        </div>
        <Wizard businessTypes={BUSINESS_TYPES.map((id) => ({ id, label: BUSINESS_LABELS[id] }))} emailOn={emailMode() !== "off"} />
      </main>
    </>
  );
}
