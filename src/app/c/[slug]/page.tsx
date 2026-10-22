import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { getProjectBySlug } from "@/lib/testimonials";
import { accentStyle } from "@/lib/theme";
import { CollectForm } from "./CollectForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = getProjectBySlug((await params).slug);
  return { title: project ? `Share your experience with ${project.name}` : "Not found" };
}

export default async function CollectPage({ params }: Props) {
  const project = getProjectBySlug((await params).slug);
  if (!project) notFound();
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
            <li>What were things like before?</li>
            <li>What changed for you?</li>
            <li>Who would you recommend it to?</li>
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
          }}
        />
      </main>
    </div>
  );
}
