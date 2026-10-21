import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProjectBySlug } from "@/lib/testimonials";
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
    <main className="container narrow" style={{ ["--accent" as string]: project.accentColor }}>
      <CollectForm
        project={{
          slug: project.slug,
          name: project.name,
          prompt: project.prompt,
          allowVideo: project.allowVideo,
          allowText: project.allowText,
        }}
      />
    </main>
  );
}
