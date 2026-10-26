import { Icon } from "@/components/Icon";
import type { Form, Project } from "@/db/schema";
import { currentConsentVersion } from "@/lib/consent";
import { env } from "@/lib/env";
import { parseFormRow } from "@/lib/forms/schema";
import { findRequestByToken } from "@/lib/requests";
import { projectQuestions } from "@/lib/testimonials";
import { accentStyle } from "@/lib/theme";
import { CollectForm } from "./CollectForm";

type Query = Record<string, string | string[] | undefined>;

/**
 * The classic one-page collection page (D1): today's CollectForm, unchanged,
 * fed by the project's mirrored columns. Shown at /c/<project> while the
 * default form is classic (and at /f/<project>/<that form>). A paused form
 * shows its closed message instead.
 */
export function ClassicCollect({ project, form, query }: { project: Project; form: Form; query: Query }) {
  if (form.status === "paused") {
    const message = parseFormRow(form).settings.closedMessage.trim();
    return (
      <div className="collect" style={accentStyle(project.accentColor)}>
        <main className="collect-main" style={{ gridColumn: "1 / -1" }}>
          <div className="done" role="status" data-testid="form-closed">
            <h1 style={{ fontSize: "var(--text-2xl)" }}>This form is closed</h1>
            <p className="muted">{message || `${project.name} isn't taking new testimonials right now. Thank you for thinking of them.`}</p>
          </div>
        </main>
      </div>
    );
  }
  // A personal request link (?r=…) prefills who they are.
  const token = query.r;
  const request = typeof token === "string" ? findRequestByToken(token) : null;
  const prefill =
    request && request.projectId === project.id
      ? { token: token as string, name: request.name ?? "", email: request.email, company: request.company ?? "" }
      : null;
  const questions = projectQuestions(project);
  const consent = currentConsentVersion(project);
  return (
    <div className="collect" style={accentStyle(project.accentColor)}>
      <aside className="collect-intro">
        <div className="collect-intro-inner">
          <div className="org">
            <span className="org-mark" aria-hidden>
              {project.name.trim().charAt(0).toUpperCase()}
            </span>
            {project.name}
          </div>
          <h1>{project.prompt}</h1>
          <ul className="tips" aria-label="Ideas for what to say">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
        <p className="fine">
          <Icon name="lock" />
          Your email stays private. Nothing is published until {project.name} approves it.
        </p>
      </aside>
      <main className="collect-main">
        <CollectForm
          project={{
            slug: project.slug,
            name: project.name,
            allowVideo: project.allowVideo,
            allowText: project.allowText,
            questions,
            maxVideoSeconds: project.maxVideoSeconds,
            maxVideoBytes: env.maxVideoBytes,
            maxImageBytes: env.maxImageBytes,
          }}
          consent={{ versionId: consent.id, text: consent.text }}
          prefill={prefill}
        />
      </main>
    </div>
  );
}
