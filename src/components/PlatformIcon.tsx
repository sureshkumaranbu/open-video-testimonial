import { Icon } from "./Icon";

/**
 * Where a testimonial was first posted (testimonials.platform). These are our
 * own lettermarks in the icon style (24px grid, 1.75 stroke), never another
 * company's logo or colours.
 */
const PLATFORMS: Record<string, { label: string; mark: string }> = {
  google: { label: "Google", mark: "G" },
  trustpilot: { label: "Trustpilot", mark: "Tp" },
  g2: { label: "G2", mark: "G2" },
  capterra: { label: "Capterra", mark: "Ca" },
  producthunt: { label: "Product Hunt", mark: "PH" },
  appstore: { label: "App Store", mark: "AS" },
  googleplay: { label: "Google Play", mark: "GP" },
  x: { label: "X", mark: "X" },
  "testimonial-to": { label: "Testimonial.to", mark: "T" },
  senja: { label: "Senja", mark: "Se" },
  shapo: { label: "Shapo", mark: "Sh" },
  website: { label: "Website", mark: "" },
};

/** "Product Hunt" for "producthunt"; unknown ids are shown as they are, capitalised. */
export function platformLabel(platform: string) {
  return PLATFORMS[platform]?.label ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** Decorative unless `label` is given (then it's an image with that name, e.g. platformLabel(p)). */
export function PlatformIcon({ platform, label, className }: { platform: string; label?: string; className?: string }) {
  const extra = className ? `platform-icon ${className}` : "platform-icon";
  if (platform === "website") return <Icon name="globe" label={label} className={extra} />;
  const mark = PLATFORMS[platform]?.mark ?? (platform.charAt(0).toUpperCase() || "?");
  return (
    <svg
      className={`icon ${extra}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-platform={platform}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <text
        x="12"
        y="12"
        dy="0.35em"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize={mark.length > 1 ? 8.5 : 11}
        fontWeight={700}
        fontFamily="var(--font-ui)"
      >
        {mark}
      </text>
    </svg>
  );
}
