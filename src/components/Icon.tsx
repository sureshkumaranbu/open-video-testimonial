/** Small hand-drawn icon set (24px grid, 1.75 stroke). Decorative by default. */
const PATHS = {
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  pen: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3",
  video: "M3.5 7.5A2 2 0 0 1 5.5 5.5h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM15.5 10.5l5-3v9l-5-3",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3",
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
