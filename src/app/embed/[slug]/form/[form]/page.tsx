import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { FormRunner } from "@/components/collect/FormRunner";
import { getFormBySlug } from "@/lib/forms";
import { runnerProps } from "@/lib/forms/runner";
import { findProjectBySlugOrAlias, withQuery } from "@/lib/projects";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string; form: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Share your experience", robots: { index: false, follow: false } };

/**
 * A form inside another site's iframe (FORM-11; frameable because it's under
 * /embed, D8). Always step by step, even for a classic form. It posts
 * `plaudit:form-resize` and `plaudit:form-submitted` to the host page
 * (public/form.js listens).
 */
export default async function EmbedFormPage({ params, searchParams }: Props) {
  const { slug, form: formSlug } = await params;
  const query = await searchParams;
  const found = findProjectBySlugOrAlias(slug);
  const form = found ? getFormBySlug(found.project.id, formSlug) : null;
  if (!found || !form) notFound();
  if (!found.canonical || form.redirectedFrom) {
    permanentRedirect(withQuery(`/embed/${found.project.slug}/form/${form.form.slug}`, query));
  }
  return <FormRunner {...runnerProps(found.project, form.form, query)} embed />;
}
