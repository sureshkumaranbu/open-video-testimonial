import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
  if (token === "test") {
    // The footer link of a campaign's "Send a test to me" email.
    return (
      <main className="container narrow withdraw">
        <h1>This was a test email</h1>
        <p className="muted">In a real email this link lets the person stop all emails from this project.</p>
      </main>
    );
  }
  const r = findRequestByUnsubscribeToken(token);
  const project = r ? getProjectById(r.projectId) : null;
  if (!r || !project) notFound();
  return (
    <main className="container narrow withdraw">
      {r.unsubscribedAt ? (
        <>
          <h1>You&apos;re unsubscribed</h1>
          <p className="muted">{project.name} won&apos;t email you again.</p>
        </>
      ) : (
        <>
          <h1>Stop emails from {project.name}?</h1>
          <p className="muted">
            {project.name} asked {r.email} for a testimonial. Unsubscribing stops the reminders, and every other email
            from {project.name} to this address.
          </p>
          <UnsubscribeButton token={token} />
        </>
      )}
    </main>
  );
}
