import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { recordPageView } from "@/lib/analytics";
import { formUrl, getDefaultForm } from "@/lib/forms";
import { findProjectBySlugOrAlias, withQuery } from "@/lib/projects";
import { ClassicCollect } from "./ClassicCollect";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const project = findProjectBySlugOrAlias((await params).slug)?.project;
  return { title: project ? `Share your experience with ${project.name}` : "Not found" };
}

export default async function CollectPage({ params, searchParams }: Props) {
  const found = findProjectBySlugOrAlias((await params).slug);
  if (!found) notFound();
  const query = await searchParams;
  // An old link (the project was renamed) moves on to the new one, ?r= and all (D17).
  if (!found.canonical) permanentRedirect(withQuery(`/c/${found.project.slug}`, query));
  const project = found.project;
  const form = getDefaultForm(project.id);
  // Once the default form is step by step, /c sends visitors to it, ?r= and all (D1).
  if (form.layout === "steps") permanentRedirect(withQuery(formUrl(project, form), query));
  // FORM-15: the classic page is counted here, on the server, so its markup stays as it was.
  await recordPageView({ type: "form", id: form.id, projectId: project.id });
  return <ClassicCollect project={project} form={form} query={query} />;
}
