import {
  ArrowDownUpIcon,
  BlocksIcon,
  BookOpenIcon,
  ClapperboardIcon,
  ClipboardListIcon,
  HeartIcon,
  ImageIcon,
  InboxIcon,
  LightbulbIcon,
  MegaphoneIcon,
  SearchIcon,
  SendIcon,
  ShoppingBagIcon,
  SlidersHorizontalIcon,
  StarIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

/** What the server tells the shell (src/app/admin/AppBar.tsx). Plain data, so it can cross to the client. */
export type Crumb = { href?: string; label: string };
export type ShellProject = { id: string; name: string; slug: string; accent: string; onAccent: string };
export type ShellSection = { id: string; label: string; path: string };
export type ShellProps = {
  trail: Crumb[];
  role: "editor" | "viewer" | null;
  analytics: boolean;
  projects: ShellProject[];
  sections: ShellSection[];
};

/** An icon per project section (ProjectTabs.tsx's ids). */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  testimonials: InboxIcon,
  requests: SendIcon,
  data: ArrowDownUpIcon,
  forms: ClipboardListIcon,
  widgets: BlocksIcon,
  walls: HeartIcon,
  seo: SearchIcon,
  settings: SlidersHorizontalIcon,
  campaigns: MegaphoneIcon,
  boosters: StarIcon,
  share: ImageIcon,
  customers: UsersIcon,
  reels: ClapperboardIcon,
  insights: LightbulbIcon,
  "case-studies": BookOpenIcon,
  commerce: ShoppingBagIcon,
};

/** The project a dashboard address belongs to, if any. */
export function projectIdFrom(pathname: string): string | null {
  const m = /^\/admin\/projects\/([^/?#]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The section an address is in: the longest section path that prefixes the
 * rest of the address ("" is the project's own page, Testimonials).
 */
export function activeSection(pathname: string, sections: ShellSection[]): string | null {
  const id = projectIdFrom(pathname);
  if (!id) return null;
  const rest = pathname.slice(`/admin/projects/${encodeURIComponent(id)}`.length).replace(/\/$/, "");
  let best: ShellSection | null = null;
  for (const s of sections) {
    const hit = s.path === "" ? rest === "" : rest === s.path || rest.startsWith(`${s.path}/`);
    if (hit && (!best || s.path.length > best.path.length)) best = s;
  }
  return best?.id ?? null;
}
