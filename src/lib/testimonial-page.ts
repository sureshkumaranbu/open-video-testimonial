import type { Metadata } from "next";
import type { Project } from "@/db/schema";
import { env } from "./env";
import { formUrl, getDefaultForm } from "./forms";
import { toFeedItems } from "./public-feed";
import { reviewJsonLd } from "./seo";
import { getProjectById, getTestimonial, type TestimonialWithTags } from "./testimonials";
import type { FeedItem } from "./widget-config";
import { getMainWall, wallConfig, wallPath } from "./walls";

/**
 * WALL-04: a testimonial's own public page, /t/<id>. The id is the row's
 * random UUID (122 random bits), so pages can't be found by counting. Only a
 * testimonial that is approved, not withdrawn, and whose author didn't ask to
 * keep it private (D11) has a page; for anything else the page, its image
 * and its beacon answer exactly as for an id that never existed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a row may have a public page. */
export function hasPublicPage(t: Pick<TestimonialWithTags, "status" | "withdrawnAt" | "consentPublic">): boolean {
  return t.status === "approved" && !t.withdrawnAt && t.consentPublic;
}

export type TestimonialPageData = {
  item: FeedItem;
  project: Pick<Project, "id" | "name" | "slug" | "accentColor" | "website" | "logoKey">;
  /** Absolute address of the page itself. */
  url: string;
  /** Where "more testimonials" goes: the main wall, else the legacy wall page. */
  wallUrl: string;
  /** The project's default form, for "Share your own". */
  formUrl: string;
};

/** The page's data, or null (so a 404) for a missing, private, unapproved or withdrawn testimonial. */
export function testimonialPage(id: string): TestimonialPageData | null {
  if (!UUID.test(id)) return null;
  const t = getTestimonial(id);
  if (!t || !hasPublicPage(t)) return null;
  const project = getProjectById(t.projectId);
  if (!project) return null;
  const main = getMainWall(project.id);
  return {
    item: toFeedItems([t])[0],
    project: { id: project.id, name: project.name, slug: project.slug, accentColor: project.accentColor, website: project.website, logoKey: project.logoKey },
    url: `${env.publicUrl}/t/${t.id}`,
    wallUrl: main ? wallPath(project, main) : `/wall/${project.slug}`,
    formUrl: formUrl(project, getDefaultForm(project.id)),
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The words a page, its preview and its share links lead with: the headline, the text, else the transcript. */
export function quoteOf(item: FeedItem): string {
  return (item.extra.headline || item.text || item.video?.transcript || "").trim().replace(/\s+/g, " ");
}

/** SHARE-03: plain share links (no scripts, no SDKs): the platform's own "post this" pages. */
export function shareLinks(url: string, text: string) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(clip(text, 200));
  return {
    x: `https://x.com/intent/post?text=${t}&url=${u}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    email: `mailto:?subject=${t}&body=${u}`,
  };
}

/** SEO-03 for /t/: the reviewed thing (the main wall's schema type and name, else a Product named after the project) with this one review. */
export function testimonialJsonLd(d: TestimonialPageData) {
  const main = getMainWall(d.project.id);
  const seo = main ? wallConfig(main).seo : null;
  return reviewJsonLd({
    type: seo?.schemaType ?? "Product",
    name: seo?.itemName || d.project.name,
    url: d.url,
    items: [d.item],
    aggregate: { count: 0, average: null },
  });
}

export function testimonialMetadata(d: TestimonialPageData): Metadata {
  const who = [d.item.name, d.item.company].filter(Boolean).join(", ");
  const title = `${who} on ${d.project.name}`;
  const description = clip(quoteOf(d.item) || `A testimonial for ${d.project.name}.`, 200);
  const image = `${d.url}/opengraph-image`;
  return {
    metadataBase: new URL(env.publicUrl),
    title: { absolute: title },
    description,
    alternates: { canonical: d.url },
    openGraph: { type: "article", title, description, url: d.url, siteName: d.project.name, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
