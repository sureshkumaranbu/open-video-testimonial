import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { FormRunner } from "@/components/collect/FormRunner";
import { getFormBySlug } from "@/lib/forms";
import { runnerProps } from "@/lib/forms/runner";
import { parseFormRow } from "@/lib/forms/schema";
import { findProjectBySlugOrAlias, withQuery } from "@/lib/projects";
import { ClassicCollect } from "@/app/c/[slug]/ClassicCollect";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ project: string; form: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolve(projectSlug: string, formSlug: string) {
  const found = findProjectBySlugOrAlias(projectSlug);
  const form = found ? getFormBySlug(found.project.id, formSlug) : null;
  return found && form ? { ...found, ...form } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { project, form } = await params;
  const found = resolve(project, form);
  if (!found) return { title: "Not found" };
  const noindex = parseFormRow(found.form).settings.noindex;
  return {
    title: `Share your experience with ${found.project.name}`,
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

/** A form's public page (FORM-01/03): the step-by-step runner, or the classic page for a classic form (D1). */
export default async function FormPage({ params, searchParams }: Props) {
  const { project: projectSlug, form: formSlug } = await params;
  const query = await searchParams;
  const found = resolve(projectSlug, formSlug);
  if (!found) notFound();
  const { project, form } = found;
  // Old project or form links move on to the current ones, ?r= and all (D17).
  if (!found.canonical || found.redirectedFrom) permanentRedirect(withQuery(`/f/${project.slug}/${form.slug}`, query));
  // The classic page shows (and sends to) the default form only; any other classic form runs step by step.
  if (form.layout === "classic" && form.isDefault) return <ClassicCollect project={project} form={form} query={query} />;
  return <FormRunner {...runnerProps(project, form, query)} />;
}
