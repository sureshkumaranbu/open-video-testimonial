import type { Metadata } from "next";
import { findRequestByUnsubscribeToken } from "@/lib/requests";
import { getProjectById } from "@/lib/testimonials";
import { UnsubscribeButton } from "./UnsubscribeButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

/**
 * Asks before unsubscribing, because link scanners in mail systems open
 * every link in a message and would otherwise unsubscribe people by accident.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = findRequestByUnsubscribeToken(token);
  const project = r ? getProjectById(r.projectId) : null;
  return (
    <main className="container narrow withdraw">
      {!r || !project ? (
        <>
          <h1>Link not found</h1>
          <p className="muted">This unsubscribe link isn&apos;t valid.</p>
        </>
      ) : r.unsubscribedAt ? (
        <>
          <h1>You&apos;re unsubscribed</h1>
          <p className="muted">{project.name} won&apos;t email you about this request again.</p>
        </>
      ) : (
        <>
          <h1>Stop emails from {project.name}?</h1>
          <p className="muted">
            {project.name} asked {r.email} for a testimonial. Unsubscribing stops the reminders for this request.
          </p>
          <UnsubscribeButton token={token} />
        </>
      )}
    </main>
  );
}
