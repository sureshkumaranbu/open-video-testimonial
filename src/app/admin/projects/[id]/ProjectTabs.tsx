import Link from "next/link";
import { type Feature, featureOn } from "@/lib/features";

// New sections are appended, so the first three still fit a phone screen
// (the nav scrolls sideways for the rest), and each waits for its feature flag.
// Project settings has no flag of its own; it goes live with forms. Each page
// calls requireFeature() with the same flag. The app shell's sidebar lists the
// same sections (projectSections), so the two never disagree.
const TABS = [
  { id: "testimonials", label: "Testimonials", path: "" },
  { id: "requests", label: "Requests", path: "/requests" },
  { id: "data", label: "Import & export", path: "/data" },
  { id: "forms", label: "Forms", path: "/forms", feature: "forms" },
  { id: "widgets", label: "Widgets", path: "/widgets", feature: "widgets" },
  { id: "walls", label: "Walls", path: "/walls", feature: "walls" },
  { id: "seo", label: "SEO", path: "/seo", feature: "walls" },
  { id: "settings", label: "Project settings", path: "/settings", feature: "forms" },
  { id: "campaigns", label: "Campaigns", path: "/campaigns", feature: "campaigns" },
  { id: "boosters", label: "Review booster", path: "/boosters", feature: "booster" },
  { id: "share", label: "Image studio", path: "/share", feature: "share" },
  { id: "customers", label: "Customers", path: "/customers", feature: "customers" },
  { id: "reels", label: "Highlight reels", path: "/reels", feature: "video2" },
  { id: "insights", label: "Insights", path: "/insights", feature: "insights" },
  { id: "case-studies", label: "Case studies", path: "/case-studies", feature: "insights" },
  { id: "commerce", label: "Commerce", path: "/commerce", feature: "commerce" },
] as const satisfies readonly { id: string; label: string; path: string; feature?: Feature }[];

export type ProjectTab = (typeof TABS)[number]["id"];

/** The sections whose feature is on, in order: for the sidebar (src/app/admin/AppBar.tsx). */
export function projectSections(): { id: ProjectTab; label: string; path: string }[] {
  return TABS.filter((t) => !("feature" in t) || featureOn(t.feature)).map(({ id, label, path }) => ({ id, label, path }));
}

/** Section navigation shared by a project's admin pages. */
export function ProjectTabs({ projectId, active }: { projectId: string; active: ProjectTab }) {
  return (
    <nav className="project-tabs" aria-label="Project sections">
      {projectSections().map((t) => (
        <Link
          key={t.id}
          href={`/admin/projects/${projectId}${t.path}`}
          aria-current={t.id === active ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
