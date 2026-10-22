import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { currentConsentVersion } from "@/lib/consent";
import { findRequestByToken } from "@/lib/requests";
import { getProjectBySlug, projectQuestions } from "@/lib/testimonials";
import { accentStyle } from "@/lib/theme";
import { CollectForm } from "./CollectForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ r?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = getProjectBySlug((await params).slug);
  return { title: project ? `Share your experience with ${project.name}` : "Not found" };
}

export default async function CollectPage({ params, searchParams }: Props) {
  const project = getProjectBySlug((await params).slug);
  if (!project) notFound();
  // A personal request link (?r=…) prefills who they are.
  const token = (await searchParams).r;
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
          }}
          consent={{ versionId: consent.id, text: consent.text }}
          prefill={prefill}
        />
      </main>
    </div>
  );
}
