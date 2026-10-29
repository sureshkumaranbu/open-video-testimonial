import "../../t/testimonial-page.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaseStudyView } from "@/components/CaseStudyView";
import { Icon } from "@/components/Icon";
import { publicCaseStudy } from "@/lib/case-studies";
import { env } from "@/lib/env";
import { featureOn } from "@/lib/features";
import { mediaUrl } from "@/lib/storage";
import { accentStyle } from "@/lib/theme";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** The `insights` flag on, the case study published and its testimonial public; anything else is a plain 404. */
async function load(p: Props) {
  return featureOn("insights") ? publicCaseStudy((await p.params).id) : null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await load(props);
  if (!d) return { metadataBase: new URL(env.publicUrl), title: "Not found", robots: { index: false } };
  const description = clip((d.content.summary || d.content.pullQuote || `A ${d.project.name} customer story.`).replace(/\s+/g, " ").trim(), 200);
  return {
    metadataBase: new URL(env.publicUrl),
    title: { absolute: `${d.title} | ${d.project.name}` },
    description,
    alternates: { canonical: d.url },
    openGraph: { type: "article", title: d.title, description, url: d.url, siteName: d.project.name },
  };
}

/**
 * SHARE-04: a published case study's page, with its PDF. Public on the same
 * terms as the testimonial's own page (/t/): approved, not withdrawn, public
 * consent (lib/case-studies.ts publicCaseStudy).
 */
export default async function CaseStudyPage(props: Props) {
  const d = await load(props);
  if (!d) notFound();
  const logo = mediaUrl(d.project.logoKey);
  const website = d.project.website && /^https?:\/\//i.test(d.project.website) ? d.project.website : null;
  return (
    <div className="tp-page" style={accentStyle(d.project.accentColor)} data-case-study={d.id}>
      <header className="tp-head">
        <span className="tp-brand">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" width={32} height={32} />
          )}
          <span>{d.project.name}</span>
        </span>
      </header>
      <main className="tp-main">
        <div className="tp-card" data-testid="case-study-page">
          <CaseStudyView
            title={d.title}
            content={d.content}
            person={{ name: d.item.name, title: d.item.title, company: d.item.company, avatarUrl: d.item.avatarUrl }}
            projectName={d.project.name}
          />
        </div>
        <nav className="tp-cta" aria-label="More from this case study">
          <a className="button secondary" href={`/cs/${d.id}/pdf`} data-testid="cs-pdf" download>
            <Icon name="download" />
            Download PDF
          </a>
          <a className="button accent" href={website ?? `/t/${d.item.id}`}>
            {website ? `Visit ${d.project.name}` : "Read the testimonial"}
            <Icon name="arrowRight" />
          </a>
        </nav>
      </main>
    </div>
  );
}
