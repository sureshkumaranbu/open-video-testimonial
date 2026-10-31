import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon, BlocksIcon, InboxIcon } from "lucide-react";
import { RemovedAlerts } from "@/components/analytics/RemovedAlerts";
import { SyncAlerts } from "@/components/SyncAlerts";
import { analyticsUi, removedAlerts } from "@/lib/analytics";
import { env } from "@/lib/env";
import { featureOn } from "@/lib/features";
import { formUrl, getDefaultForm } from "@/lib/forms";
import { RESUME_COOKIE, verifyRequest } from "@/lib/oauth";
import { failingSyncs } from "@/lib/importers/sync";
import { getWelcome } from "@/lib/onboarding";
import { onlyOpen, roleAtLeast } from "@/lib/access";
import { pageAccess } from "@/lib/server-session";
import { countByStatus, listProjects } from "@/lib/testimonials";
import { accentStyle } from "@/lib/theme";
import { CopyLink } from "./_dash/CopyLink";
import { ImportProjectForm, NewProjectForm } from "./_dash/ProjectForms";
import { AppBar } from "./AppBar";
import { WelcomeCard } from "./welcome/WelcomeCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

type HomeProject = ReturnType<typeof listProjects>[number] & {
  counts: ReturnType<typeof countByStatus>;
  link: string;
};

/** A project's collection link, as customers get it (the default form's address). */
function collectionLink(p: ReturnType<typeof listProjects>[number]) {
  try {
    return `${env.publicUrl}${formUrl(p, getDefaultForm(p.id))}`;
  } catch {
    return `${env.publicUrl}/c/${p.slug}`;
  }
}

const quick =
  "relative z-10 inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted-foreground transition-[background-color,color] duration-150 ease-out hover:bg-accent hover:text-foreground max-sm:min-h-11";

function ProjectCard({ p, widgets }: { p: HomeProject; widgets: boolean }) {
  const accent = accentStyle(p.accentColor);
  const pending = p.counts.pending;
  return (
    <li
      className="project-tile relative flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-1)]"
      style={{ ["--project" as string]: accent["--accent"] }}
      data-testid="project-card"
    >
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
          style={{
            background: accent["--accent"],
            color: accent["--on-accent"],
          }}
        >
          {p.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base leading-snug font-semibold tracking-tight text-foreground">
            {/* The title's link covers the whole card; the quick links sit above it. */}
            <Link href={`/admin/projects/${p.id}`} className="project-tile-link after:absolute after:inset-0 after:rounded-2xl after:content-['']">
              {p.name}
            </Link>
          </h3>
          <p className="truncate font-mono text-xs text-muted-foreground">/{p.slug}</p>
        </div>
        {pending > 0 && (
          <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-[var(--warn-soft)] px-2.5 text-xs font-bold text-[var(--warn)] tabular-nums">
            {pending} new
          </span>
        )}
      </div>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-[var(--warn)]" />
          <dt className="sr-only">Pending</dt>
          <dd className="font-semibold text-foreground tabular-nums">{pending} pending</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-[var(--ok)]" />
          <dt className="sr-only">Approved</dt>
          <dd className="font-semibold text-foreground tabular-nums">{p.counts.approved} approved</dd>
        </div>
      </dl>
      <div className="-mx-2 -mb-1 flex flex-wrap items-center gap-0.5 border-t border-border pt-3">
        <Link href={`/admin/projects/${p.id}`} className={quick}>
          <InboxIcon aria-hidden className="size-4" />
          Inbox
        </Link>
        <CopyLink url={p.link} className={quick} />
        {widgets && (
          <Link href={`/admin/projects/${p.id}/widgets`} className={quick}>
            <BlocksIcon aria-hidden className="size-4" />
            Widgets
          </Link>
        )}
      </div>
    </li>
  );
}

/** No projects yet: what a project is, and the way to make one, in one place. */
function EmptyHome({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section
      className="relative overflow-hidden rounded-[1.5rem] border border-border bg-card px-5 py-10 text-center sm:px-10 sm:py-14"
      data-testid="dash-empty"
    >
      {/* Three sample tiles, fanned like a small wall: what the first project will collect. */}
      <div aria-hidden className="mx-auto mb-8 flex h-28 w-64 max-w-full items-end justify-center">
        {[
          ["bg-tint-1", "-rotate-6 translate-y-2"],
          ["bg-tint-3", "z-10 -translate-y-1"],
          ["bg-tint-2", "rotate-6 translate-y-2"],
        ].map(([tint, place], i) => (
          <div key={i} className={`-mx-3 flex h-24 w-24 flex-col justify-between rounded-2xl p-3 text-left shadow-tile ${tint} ${place}`}>
            <span className="flex gap-0.5">
              {[0, 1, 2, 3, 4].map((n) => (
                <span key={n} className="size-2 rounded-full bg-foreground/70" />
              ))}
            </span>
            <span className="flex flex-col gap-1">
              <span className="h-1.5 w-full rounded-full bg-foreground/25" />
              <span className="h-1.5 w-2/3 rounded-full bg-foreground/25" />
            </span>
          </div>
        ))}
      </div>
      <h2 className="font-display text-2xl leading-tight font-bold tracking-tight text-balance text-foreground">
        {isAdmin ? "Start your first wall of love" : "No projects to show yet"}
      </h2>
      <p className="mx-auto mt-2 max-w-[52ch] text-base text-pretty text-muted-foreground">
        {isAdmin
          ? "A project holds one product's or brand's testimonials: its own collection link, an inbox to review what arrives, and widgets and walls to show the best."
          : "Projects appear here once an owner gives you access to one."}
      </p>
    </section>
  );
}

export default async function AdminHome() {
  const { session, access } = await pageAccess();
  // INT-04: someone who signed in to approve an MCP connection goes back to it (a signed request, to our own page only).
  const resume = featureOn("mcp") ? (await cookies()).get(RESUME_COOKIE)?.value : undefined;
  if (resume && verifyRequest(decodeURIComponent(resume))) redirect(`/admin/oauth?req=${encodeURIComponent(decodeURIComponent(resume))}`);
  const isAdmin = roleAtLeast(session.role, "admin");
  // D10: onboarding is offered here as a card, never as a redirect.
  const welcome = isAdmin && featureOn("onboarding") && !getWelcome(session.email);
  const projects: HomeProject[] = onlyOpen(access, listProjects()).map((p) => ({
    ...p,
    counts: countByStatus(p.id),
    link: collectionLink(p),
  }));
  const waiting = projects.reduce((n, p) => n + p.counts.pending, 0);
  // The quickest way to the work: the project with the most waiting.
  const busiest = waiting > 0 ? projects.reduce((a, b) => (b.counts.pending > a.counts.pending ? b : a)) : null;
  const widgets = featureOn("widgets");

  return (
    <>
      <AppBar />
      <main className="container stack-lg">
        <div className="ui-app">
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4" data-testid="dash-greeting">
            <div className="min-w-0">
              <h1 className="font-display text-[2rem] leading-[1.1] font-bold tracking-tight text-balance text-foreground">
                {projects.length === 0 ? "Welcome to Plaudit" : "Welcome back"}
              </h1>
              <p className="mt-2 text-base text-muted-foreground" data-testid="dash-status">
                {projects.length === 0 ? (
                  "Create your first project to get a collection link."
                ) : waiting > 0 ? (
                  <>
                    <strong className="font-semibold text-foreground tabular-nums">
                      {waiting} new {waiting === 1 ? "testimonial is" : "testimonials are"}
                    </strong>{" "}
                    waiting for review.
                  </>
                ) : (
                  "You're all caught up."
                )}
              </p>
            </div>
            {busiest && (
              <Link
                href={`/admin/projects/${busiest.id}`}
                className="group inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground transition-[translate,scale,box-shadow] duration-200 ease-out hover:shadow-lift motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.97]"
              >
                Review {busiest.name}
                <ArrowRightIcon aria-hidden className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
              </Link>
            )}
          </header>
        </div>

        {analyticsUi() && <RemovedAlerts alerts={removedAlerts(access.all ? undefined : [...access.ids])} />}
        {featureOn("imports2") && <SyncAlerts alerts={failingSyncs()} />}

        <div className="ui-app">
          <div className="flex flex-col gap-8">
            {welcome && <WelcomeCard first={projects.length === 0} />}

            {projects.length > 0 ? (
              <section aria-labelledby="projects-h" className="flex flex-col gap-4">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="projects-h" className="text-lg font-semibold tracking-tight text-foreground">
                    Projects
                  </h2>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {projects.length} {projects.length === 1 ? "project" : "projects"}
                  </span>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {projects.map((p) => (
                    <ProjectCard key={p.id} p={p} widgets={widgets} />
                  ))}
                </ul>
              </section>
            ) : (
              <EmptyHome isAdmin={isAdmin} />
            )}

            {isAdmin && (
              <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <NewProjectForm first={projects.length === 0} />
                <ImportProjectForm />
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
