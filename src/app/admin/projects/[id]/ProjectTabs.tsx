import Link from "next/link";
import { type Feature, featureOn } from "@/lib/features";

// New sections are appended, so the first three still fit a phone screen
// (the nav scrolls sideways for the rest), and each waits for its feature flag.
// Project settings has no flag of its own; it goes live with forms. Each page
// calls requireFeature() with the same flag.
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
] as const satisfies readonly { id: string; label: string; path: string; feature?: Feature }[];

export type ProjectTab = (typeof TABS)[number]["id"];

/** Section navigation shared by a project's admin pages. */
export function ProjectTabs({ projectId, active }: { projectId: string; active: ProjectTab }) {
  return (
    <nav className="project-tabs" aria-label="Project sections">
      {TABS.filter((t) => !("feature" in t) || featureOn(t.feature)).map((t) => (
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
