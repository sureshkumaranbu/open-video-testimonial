import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findRequestByDeclineToken } from "@/lib/requests";
import { getProjectById } from "@/lib/testimonials";
import { DeclineButton } from "./DeclineButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "No thanks", robots: { index: false, follow: false } };

/**
 * The "No thanks" link in campaign emails (M9, REQ-05). One press of the
 * button declines: mail scanners open every link in a message, so opening the
 * page alone changes nothing (the same reason /u asks first).
 */
export default async function DeclinePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token === "test") {
    return (
      <main className="container narrow withdraw">
        <h1>This was a test email</h1>
        <p className="muted">In a real campaign email this link lets the person say no thanks, which stops the reminders.</p>
      </main>
    );
  }
  const r = findRequestByDeclineToken(token);
  const project = r ? getProjectById(r.projectId) : null;
  if (!r || !project) notFound();
  if (r.status === "declined") {
    return (
      <main className="container narrow withdraw">
        <h1>No problem</h1>
        <p className="muted">{project.name} won&apos;t ask you again about this.</p>
      </main>
    );
  }
  if (r.status === "responded") {
    return (
      <main className="container narrow withdraw">
        <h1>You already responded</h1>
        <p className="muted">Thank you for sharing your experience with {project.name}. There&apos;s nothing else to do.</p>
      </main>
    );
  }
  return (
    <main className="container narrow withdraw">
      <h1>Not for you?</h1>
      <p className="muted">
        {project.name} asked {r.email} for a testimonial. Say no thanks and they won&apos;t send you reminders about it.
      </p>
      <DeclineButton token={token} />
    </main>
  );
}
