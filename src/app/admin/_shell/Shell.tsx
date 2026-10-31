"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ChartColumnIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  LayoutGridIcon,
  LogOutIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { LogoutButton } from "../AdminForms";
import { SIDEBAR_KEY } from "./boot";
import { ModePicker, ModeToggle } from "./ModeControls";
import { activeSection, projectIdFrom, SECTION_ICONS, type ShellProject, type ShellProps } from "./nav";

/* ------------------------------------------------------------------ state */

const root = () => document.documentElement;
const isCollapsed = () => root().getAttribute("data-sidebar") === "collapsed";

function subscribeCollapsed(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(root(), { attributes: true, attributeFilter: ["data-sidebar"] });
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SIDEBAR_KEY) return;
    setCollapsed(e.newValue === "collapsed", false);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    mo.disconnect();
    window.removeEventListener("storage", onStorage);
  };
}

function setCollapsed(on: boolean, remember = true) {
  if (on) root().setAttribute("data-sidebar", "collapsed");
  else root().removeAttribute("data-sidebar");
  if (!remember) return;
  try {
    if (on) localStorage.setItem(SIDEBAR_KEY, "collapsed");
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    // Private mode: it still applies to this page view.
  }
}

/** Whether the desktop sidebar is collapsed to icons; false before hydration (boot.ts already drew it right). */
function useCollapsed() {
  return useSyncExternalStore(subscribeCollapsed, isCollapsed, () => false);
}

/* ------------------------------------------------------------------ bits */

type Variant = "rail" | "sheet";

/** plaudit. — the brand's dot in --primary. Collapsed, just "p.". */
function Wordmark({ short = false }: { short?: boolean }) {
  return (
    <span className="font-display text-[1.375rem] leading-none font-extrabold tracking-display text-foreground">
      {short ? "p" : "plaudit"}
      <span className="text-primary">.</span>
    </span>
  );
}

/** The project's mark: its initial on its own colour (text colour picked for contrast on the server). */
function ProjectMark({ project, className }: { project: ShellProject; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-[0.625rem] text-sm font-bold", className)}
      style={{ background: project.accent, color: project.onAccent }}
    >
      {project.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** In the collapsed rail a label is only for screen readers, so pointer users get it as a tooltip. */
function Tip({ label, show, portal, children }: { label: string; show: boolean; portal: HTMLElement | null; children: ReactNode }) {
  return (
    <Tooltip.Root open={show ? undefined : false} delayDuration={200}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={portal}>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-50 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background shadow-[var(--shadow-3)] data-[state=closed]:animate-pop-out data-[state=delayed-open]:animate-pop-in"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const itemClass = cn(
  "group/item flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground lg:min-h-10",
  "transition-[background-color,color] duration-150 ease-out hover:bg-accent hover:text-foreground",
  "aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-foreground",
  "collapsed:justify-center collapsed:px-0",
);
const iconClass =
  "size-[1.15rem] shrink-0 transition-colors duration-150 group-hover/item:text-foreground group-aria-[current=page]/item:text-primary";

function NavItem({
  href,
  label,
  icon: Icon,
  current,
  collapsed,
  portal,
  onNavigate,
  testId,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  current: boolean;
  collapsed: boolean;
  portal: HTMLElement | null;
  onNavigate?: () => void;
  testId?: string;
}) {
  return (
    <li>
      <Tip label={label} show={collapsed} portal={portal}>
        <Link href={href} aria-current={current ? "page" : undefined} className={itemClass} onClick={onNavigate} data-testid={testId}>
          <Icon aria-hidden className={iconClass} />
          <span className="min-w-0 truncate collapsed:sr-only">{label}</span>
        </Link>
      </Tip>
    </li>
  );
}

/* ------------------------------------------------------------------ project switcher */

function ProjectSwitcher({
  projects,
  current,
  collapsed,
  portal,
  onNavigate,
}: {
  projects: ShellProject[];
  current: ShellProject | null;
  collapsed: boolean;
  portal: HTMLElement | null;
  onNavigate?: () => void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="project-switcher"
          className={cn(
            "group flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl border border-border bg-background px-2 text-left transition-[border-color,background-color,box-shadow] duration-150 ease-out lg:min-h-12",
            "hover:border-input hover:bg-card data-[state=open]:border-input data-[state=open]:bg-card data-[state=open]:shadow-[var(--shadow-2)]",
            "collapsed:justify-center collapsed:border-transparent collapsed:bg-transparent collapsed:px-0",
          )}
        >
          {current ? (
            <ProjectMark project={current} />
          ) : (
            <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-[0.625rem] bg-muted text-muted-foreground">
              <LayoutGridIcon className="size-4" />
            </span>
          )}
          <span className="min-w-0 flex-1 collapsed:sr-only">
            {current && <span className="sr-only">Switch project: </span>}
            <span className="block truncate text-sm font-semibold text-foreground">{current ? current.name : "Choose a project"}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {current ? `/${current.slug}` : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
            </span>
          </span>
          <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground collapsed:hidden" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portal}>
        <DropdownMenu.Content
          align="start"
          side={collapsed ? "right" : "bottom"}
          sideOffset={6}
          collisionPadding={12}
          data-testid="project-menu"
          className={cn(
            "z-50 w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-3)]",
            "max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))]",
            "data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
          )}
        >
          <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">Switch project</DropdownMenu.Label>
          {projects.map((p) => (
            <DropdownMenu.Item key={p.id} asChild>
              <Link
                href={`/admin/projects/${p.id}`}
                onClick={onNavigate}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2 text-sm outline-none data-[highlighted]:bg-accent"
              >
                <ProjectMark project={p} className="size-7 text-xs" />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                {current?.id === p.id && <CheckIcon aria-label="Current project" className="size-4 shrink-0 text-primary" />}
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="mx-1 my-1.5 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <Link
              href="/admin"
              onClick={onNavigate}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2 text-sm font-medium text-muted-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground"
            >
              <span aria-hidden className="inline-flex size-7 items-center justify-center">
                <LayoutGridIcon className="size-4" />
              </span>
              All projects
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ------------------------------------------------------------------ the sidebar's contents */

function SidebarBody({
  variant,
  props,
  portal,
  onNavigate,
}: {
  variant: Variant;
  props: ShellProps;
  portal: HTMLElement | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const collapsedNow = useCollapsed();
  const collapsed = variant === "rail" && collapsedNow;
  const projectId = projectIdFrom(pathname);
  const current = props.projects.find((p) => p.id === projectId) ?? null;
  const section = activeSection(pathname, props.sections);
  const tip = { collapsed, portal, onNavigate };

  return (
    <>
      {variant === "rail" && (
        <div className="flex h-15 shrink-0 items-center px-5 collapsed:justify-center collapsed:px-0">
          <Link href="/admin" aria-label="Plaudit dashboard" className="inline-flex min-h-11 items-center rounded-md px-1">
            <span className="collapsed:hidden">
              <Wordmark />
            </span>
            <span className="hidden collapsed:inline">
              <Wordmark short />
            </span>
          </Link>
        </div>
      )}

      {props.projects.length > 0 && (
        <div className={cn("shrink-0", variant === "rail" ? "px-3 pb-2 collapsed:px-2" : "")}>
          <ProjectSwitcher projects={props.projects} current={current} collapsed={collapsed} portal={portal} onNavigate={onNavigate} />
        </div>
      )}

      <div className={cn("app-rail-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto", variant === "rail" ? "px-3 py-2 collapsed:px-2" : "")}>
        {current && (
          <nav aria-label="Project sections">
            <ul className="flex flex-col gap-0.5">
              {props.sections.map((s) => (
                <NavItem
                  key={s.id}
                  href={`/admin/projects/${current.id}${s.path}`}
                  label={s.label}
                  icon={SECTION_ICONS[s.id] ?? LayoutGridIcon}
                  current={section === s.id}
                  {...tip}
                />
              ))}
            </ul>
          </nav>
        )}
        <nav aria-label="Dashboard" className={current ? "mt-auto" : undefined}>
          <ul className={cn("flex flex-col gap-0.5", current && "border-t border-border pt-3")}>
            <NavItem href="/admin" label="Projects" icon={LayoutGridIcon} current={pathname === "/admin"} {...tip} testId="nav-projects" />
            {props.analytics && (
              <NavItem href="/admin/analytics" label="Analytics" icon={ChartColumnIcon} current={pathname.startsWith("/admin/analytics")} {...tip} />
            )}
            <NavItem href="/admin/settings" label="Settings" icon={SettingsIcon} current={pathname.startsWith("/admin/settings")} {...tip} />
          </ul>
        </nav>
      </div>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-2 border-t border-border",
          variant === "rail" ? "p-3 collapsed:items-center collapsed:px-2" : "pt-4",
        )}
      >
        <ModePicker className="collapsed:hidden" compact={variant === "rail"} testId={variant === "rail" ? "mode-picker" : "menu-mode-picker"} />
        {variant === "rail" && (
          <Tip label="Dark mode" show portal={portal}>
            <ModeToggle className="hidden collapsed:inline-flex" testId="rail-mode-toggle" />
          </Tip>
        )}
        <div className="flex items-center gap-1 collapsed:flex-col">
          <Tip label="Sign out" show={collapsed} portal={portal}>
            <LogoutButton
              className={cn(
                "inline-flex min-h-12 flex-1 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground lg:min-h-10",
                "collapsed:size-10 collapsed:flex-none collapsed:justify-center collapsed:px-0",
              )}
            >
              <LogOutIcon aria-hidden className="size-[1.15rem] shrink-0" />
              <span className="collapsed:sr-only">Sign out</span>
            </LogoutButton>
          </Tip>
          {variant === "rail" && <CollapseButton portal={portal} />}
        </div>
      </div>
    </>
  );
}

function CollapseButton({ portal }: { portal: HTMLElement | null }) {
  const collapsed = useCollapsed();
  const Icon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <Tip label={label} show portal={portal}>
      <button
        type="button"
        data-testid="sidebar-collapse"
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls="app-rail"
        onClick={() => setCollapsed(!collapsed)}
        className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
      >
        <Icon aria-hidden className="size-[1.15rem]" />
      </button>
    </Tip>
  );
}

/* ------------------------------------------------------------------ the shell */

/**
 * The dashboard's frame: a sidebar on desktop (collapsible to icons, which
 * is remembered), and a top bar with the breadcrumb trail. On phones and
 * tablets the sidebar opens from the top bar's menu button as a sheet, with
 * focus kept inside until Esc or a link closes it. Pages render next to it.
 */
export function Shell(props: ShellProps) {
  const pathname = usePathname() ?? "";
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  // From now on a collapse may animate (app.css); never on the first paint.
  useEffect(() => {
    const id = requestAnimationFrame(() => root().setAttribute("data-shell-ready", ""));
    return () => cancelAnimationFrame(id);
  }, []);
  // A link in the sheet leads somewhere else: close it there.
  useEffect(() => setOpen(false), [pathname]);

  const trail = props.trail;
  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={300}>
      {/* A box-less wrapper: the utilities apply inside a .ui-app, and the page's own content stays outside it. */}
      <div className="ui-app app-shell">
        <div
          id="app-rail"
          className="app-rail fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r border-border bg-card lg:flex"
          data-testid="app-sidebar"
        >
          <SidebarBody variant="rail" props={props} portal={portal} />
        </div>

        <header className="app-bar sticky top-0 z-20 border-b border-border bg-background">
          <div className="flex h-15 items-center gap-2 px-4 sm:px-5 lg:px-8">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open menu"
                  data-testid="menu-button"
                  className="-ml-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors duration-150 hover:bg-accent lg:hidden"
                >
                  <MenuIcon aria-hidden className="size-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" container={portal} data-testid="app-menu" className="gap-5 bg-card p-4 pt-5 shadow-[var(--shadow-3)]">
                <div className="flex min-h-11 items-center pr-12 pl-1">
                  <SheetTitle>
                    <span className="sr-only">Menu</span>
                    <Wordmark />
                  </SheetTitle>
                  <SheetDescription className="sr-only">Projects, this project&apos;s sections, settings and sign out.</SheetDescription>
                </div>
                <SidebarBody variant="sheet" props={props} portal={portal} onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>

            <nav className="crumbs min-w-0 flex-1" aria-label="Breadcrumb">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                {trail.map((c, i) => {
                  const last = i === trail.length - 1;
                  return (
                    <li
                      key={`${i}-${c.label}`}
                      className={cn("crumb min-w-0 items-center gap-1.5", last ? "current flex" : "hidden shrink-[2] sm:flex")}
                    >
                      {i > 0 && <ChevronRightIcon aria-hidden className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />}
                      {c.href && !last ? (
                        <Link
                          href={c.href}
                          className="min-w-0 truncate rounded-md font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
                        >
                          {c.label}
                        </Link>
                      ) : c.href ? (
                        <Link href={c.href} aria-current="page" className="crumb-here min-w-0 truncate rounded-md font-semibold text-foreground">
                          {c.label}
                        </Link>
                      ) : (
                        <span
                          aria-current={last ? "page" : undefined}
                          className={cn("min-w-0 truncate", last ? "crumb-here font-semibold text-foreground" : "font-medium text-muted-foreground")}
                        >
                          {c.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="app-bar-actions flex shrink-0 items-center gap-1">
              {props.role && (
                <span
                  data-testid="role-badge"
                  title={
                    props.role === "viewer"
                      ? "You can look and share approved testimonials, not change things"
                      : "You can change content, not settings or the team"
                  }
                  className="inline-flex h-7 items-center rounded-full border border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground"
                >
                  {props.role === "viewer" ? "Viewer" : "Editor"}
                </span>
              )}
              <ModeToggle className="lg:hidden" testId="topbar-mode-toggle" />
            </div>
          </div>
        </header>

        <div ref={setPortal} />
      </div>
    </Tooltip.Provider>
  );
}
