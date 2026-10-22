import type { Metadata } from "next";
import { findByWithdrawToken } from "@/lib/consent";
import { getProjectById } from "@/lib/testimonials";
import { WithdrawForm } from "./WithdrawForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Withdraw your testimonial", robots: { index: false, follow: false } };

/** Private page linked from the thank-you screen (and email) for withdrawing consent. */
export default async function WithdrawPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = findByWithdrawToken(token);
  const project = row ? getProjectById(row.projectId) : null;

  return (
    <main className="container narrow withdraw">
      {!row || !project ? (
        <>
          <h1>Link not found</h1>
          <p className="muted">This withdrawal link isn&apos;t valid. Check that you copied all of it.</p>
        </>
      ) : row.withdrawnAt ? (
        <>
          <h1>Already withdrawn</h1>
          <p className="muted">
            You withdrew this testimonial on {row.withdrawnAt.toLocaleDateString("en", { dateStyle: "long" })}. It isn&apos;t
            shown anywhere by {project.name}.
          </p>
        </>
      ) : (
        <>
          <h1>Withdraw your testimonial?</h1>
          <p>
            You sent a testimonial to <strong>{project.name}</strong> as <strong>{row.authorName}</strong> on{" "}
            {row.createdAt.toLocaleDateString("en", { dateStyle: "long" })}.
          </p>
          <p className="muted">
            Withdrawing takes it off {project.name}&apos;s website and widgets straight away, and they won&apos;t be able
            to publish it again. Copies they already shared elsewhere (for example on social media) need to be removed
            by them; contact them if that applies.
          </p>
          <WithdrawForm token={token} projectName={project.name} />
        </>
      )}
    </main>
  );
}
