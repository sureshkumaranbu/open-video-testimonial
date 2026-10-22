import Link from "next/link";

const TABS = [
  { id: "testimonials", label: "Testimonials", path: "" },
  { id: "requests", label: "Requests", path: "/requests" },
  { id: "data", label: "Import & export", path: "/data" },
] as const;

export type ProjectTab = (typeof TABS)[number]["id"];

/** Section navigation shared by a project's admin pages. */
export function ProjectTabs({ projectId, active }: { projectId: string; active: ProjectTab }) {
  return (
    <nav className="project-tabs" aria-label="Project sections">
      {TABS.map((t) => (
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
