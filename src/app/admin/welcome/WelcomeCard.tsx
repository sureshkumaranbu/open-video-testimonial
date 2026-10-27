"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/app/admin/api";
import "@/app/admin/onboarding.css";

/** The dashboard's Get started card (D10: a link to the wizard, never a redirect). Skip hides it for this person. */
export function WelcomeCard({ first }: { first: boolean }) {
  const router = useRouter();
  return (
    <section className="panel ob-welcome" data-testid="welcome-card" aria-labelledby="welcome-h">
      <div className="panel-body row spread">
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <h2 id="welcome-h" style={{ fontSize: "var(--text-base)" }}>
            {first ? "Get started" : "Set up another project"}
          </h2>
          <p className="muted small">
            Answer three questions and we&apos;ll find testimonials on your site, then make a collection form, a Wall of Love and two widgets in
            your colours.
          </p>
        </div>
        <div className="row">
          <Link className="button" href="/admin/welcome">
            Start setup
          </Link>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              await api("/api/admin/onboarding", { method: "POST", json: { skip: true } }).catch(() => null);
              router.refresh();
            }}
          >
            Skip
          </button>
        </div>
      </div>
    </section>
  );
}
