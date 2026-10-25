/** Small hand-drawn icon set (24px grid, 1.75 stroke). Decorative by default. */
const PATHS = {
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  pen: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3",
  video: "M3.5 7.5A2 2 0 0 1 5.5 5.5h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM15.5 10.5l5-3v9l-5-3",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  copy: "M9 9h9.5v11H9zM15 9V4.5H5.5V15H9",
  external: "M13.5 4.5h6v6M19.5 4.5 11 13M10 5.5H5.5v13h13V14",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5",
  undo: "M9 14 4.5 9.5 9 5M4.5 9.5h9a5.5 5.5 0 0 1 0 11H11",
  close: "M6 6l12 12M18 6 6 18",
  lock: "M6.5 10.5h11v9h-11zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5",
  inbox: "M3.5 13.5 6 5.5h12l2.5 8v5h-17zM3.5 13.5h5l1 2h5l1-2h5",
  code: "M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5",
  sliders: "M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1M14 4v4M8 10v4M16 16v4",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  logout: "M14.5 4.5h4v15h-4M10 8l-4 4 4 4M6 12h9.5",
  server: "M4.5 5h15v6h-15zM4.5 13h15v6h-15zM8 8h.01M8 16h.01",
  eyeOff: "M4 4l16 16M10.6 6.2A9 9 0 0 1 21 12a12 12 0 0 1-2.2 3M6.6 7.6A12 12 0 0 0 3 12s3.5 6 9 6a8.5 8.5 0 0 0 3.6-.8M9.9 10a3 3 0 0 0 4.1 4.1",
  play: "M8 5.5v13l10.5-6.5z",
  pause: "M8.5 5.5v13M15.5 5.5v13",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  infinity: "M12 12c-2-2.7-3.6-4-5.5-4a4 4 0 0 0 0 8c1.9 0 3.5-1.3 5.5-4s3.6-4 5.5-4a4 4 0 0 1 0 8c-1.9 0-3.5-1.3-5.5-4z",
  // Phase 1: inbox, builders and settings.
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.3 15.3 20 20",
  filter: "M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z",
  sort: "M7.5 4.5v15M4 16l3.5 3.5L11 16M16.5 19.5v-15M13 8l3.5-3.5L20 8",
  chevronLeft: "M14.5 6 8.5 12l6 6",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronDown: "M6 9.5l6 6 6-6",
  eye: "M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  more: "M5.5 12h.01M12 12h.01M18.5 12h.01",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  history: "M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9M4.5 4.5V9H9M12 8v4.5l3 2",
  restore: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3l2.2 2.3M19.5 4.5V9H15",
  image: "M4.5 5.5h15v13h-15zM4.5 15.5l4.5-4.5 4 4 2.5-2.5 4 4M15 9.5h.01",
  link: "M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1",
  qr: "M4.5 4.5h5v5h-5zM14.5 4.5h5v5h-5zM4.5 14.5h5v5h-5zM14.5 14.5h2v2h-2zM19.5 14.5v.01M14.5 19.5h.01M17.5 17.5h2v2h-2z",
  mail: "M4 6.5h16v11H4zM4.5 7l7.5 6 7.5-6",
  bell: "M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5h-14zM10 20.5h4",
  globe: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM3.5 12h17M12 3.5c2.2 2.3 3.4 5.2 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.2-3.4-8.5s1.2-6.2 3.4-8.5z",
  palette:
    "M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.8-.8 1.8-1.7 0-1.1-.9-1.6-.9-2.6 0-1 .8-1.7 1.8-1.7h2.1a3.7 3.7 0 0 0 3.7-3.7c0-4-3.8-7.3-8.5-7.3zM7.8 12h.01M9.5 8h.01M14.5 8h.01",
  layout: "M4.5 4.5h15v15h-15zM4.5 10h15M10 10v9.5",
  import: "M3.5 12h10M9.5 8l4 4-4 4M13 4.5h5.5v15H13",
  github:
    "M12 3.5a8.5 8.5 0 0 0-2.7 16.6c.4.1.6-.2.6-.4v-1.6c-2.4.5-2.9-1-2.9-1-.4-1-1-1.3-1-1.3-.8-.5.1-.5.1-.5.9.1 1.3.9 1.3.9.8 1.3 2 .9 2.5.7.1-.5.3-.9.6-1.1-1.9-.2-3.9-1-3.9-4.2 0-.9.3-1.7.9-2.3-.1-.2-.4-1.1.1-2.3 0 0 .7-.2 2.3.9a8 8 0 0 1 4.2 0c1.6-1.1 2.3-.9 2.3-.9.5 1.2.2 2.1.1 2.3.5.6.9 1.4.9 2.3 0 3.3-2 4-3.9 4.2.3.3.6.8.6 1.6v2.3c0 .2.2.5.6.4A8.5 8.5 0 0 0 12 3.5z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  const filled = name === "star" || name === "github";
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
