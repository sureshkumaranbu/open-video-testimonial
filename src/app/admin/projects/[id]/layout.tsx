import { requireProjectPage } from "@/lib/server-session";

/** TEAM-01: every page of a project checks that the signed-in person may open it. */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireProjectPage((await params).id);
  return children;
}
