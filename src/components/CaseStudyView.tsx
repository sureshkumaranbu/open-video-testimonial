import type { CaseStudyContent } from "@/lib/case-studies";
import "./case-study.css";

export type CaseStudyPerson = { name: string; title: string | null; company: string | null; avatarUrl: string | null };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * SHARE-04: a case study as people read it. Stateless, so the public page
 * (/cs/<id>) renders it on the server and the editor's live preview renders
 * the same markup from the fields being typed. Empty sections are left out.
 */
export function CaseStudyView({ title, content, person, projectName, headingLevel = 1 }: { title: string; content: CaseStudyContent; person: CaseStudyPerson; projectName: string; headingLevel?: 1 | 2 }) {
  const byline = [person.title, person.company].filter(Boolean).join(", ");
  const H = headingLevel === 1 ? "h1" : "h2";
  const S = headingLevel === 1 ? "h2" : "h3";
  const sections = [
    ["The challenge", content.challenge],
    ["The solution", content.solution],
    ["The result", content.result],
  ] as const;
  return (
    <article className="csv" data-testid="case-study-view">
      <p className="csv-kicker">{projectName} customer story</p>
      <H className="csv-title">{title || "Untitled case study"}</H>
      {content.summary.trim() && <p className="csv-summary">{content.summary}</p>}
      <div className="csv-person">
        {person.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="csv-avatar" src={person.avatarUrl} alt="" width={44} height={44} />
        ) : (
          <span className="csv-avatar csv-initials" aria-hidden="true">
            {initials(person.name)}
          </span>
        )}
        <span>
          <strong>{person.name}</strong>
          {byline && <span className="csv-byline">{byline}</span>}
        </span>
      </div>
      {content.metrics.length > 0 && (
        <ul className="csv-metrics" aria-label="Results in numbers">
          {content.metrics.map((m, i) => (
            <li key={i}>
              <span className="csv-metric-value">{m.value}</span>
              <span className="csv-metric-label">{m.label}</span>
            </li>
          ))}
        </ul>
      )}
      {content.pullQuote.trim() && (
        <figure className="csv-quote">
          <blockquote>
            <p>{content.pullQuote.trim()}</p>
          </blockquote>
          <figcaption>{person.name}</figcaption>
        </figure>
      )}
      {sections.map(([heading, body]) =>
        body.trim() ? (
          <section key={heading} className="csv-section">
            <S>{heading}</S>
            <p>{body}</p>
          </section>
        ) : null,
      )}
    </article>
  );
}
