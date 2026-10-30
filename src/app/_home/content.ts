/**
 * The home page's words and facts. Product claims here must stay true of the
 * app (README, docs/); sample people come from samples.ts and are always
 * labelled as samples on the page.
 */
import { byId, PEOPLE, type SamplePerson, type SampleVideoTestimonial } from "./samples";

export const REPO = "https://github.com/sureshkumaranbu/open-video-testimonial";
export const QUICK_START = `${REPO}#quick-start-with-docker`;
export const DASHBOARD = "/admin";

export const HEADLINE = "Turn happy customers into your best page.";
export const LEDE =
  "Collect video and text testimonials, approve the best, then show them off in a wall like this one. Free, open source and yours to host.";

export const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#studio", label: "Widgets" },
  { href: "#features", label: "Features" },
  { href: "#self-host", label: "Self-host" },
  { href: "#faq", label: "FAQ" },
] as const;

export type Tint = 1 | 2 | 3 | 4 | 5;

export type WallTile =
  | { kind: "video"; video: SampleVideoTestimonial; shape: "tall" | "square"; focus: string; phone?: boolean }
  | { kind: "text"; person: SamplePerson; rating: number; text: string; tint: Tint; big?: boolean; phone?: boolean };

/**
 * The hero wall, after the headline tile, in reading order. `phone: false`
 * tiles are left out on small screens so the wall doesn't run for pages.
 */
export const WALL: WallTile[] = [
  { kind: "video", video: byId("maya"), shape: "tall", focus: "34% 30%" },
  { kind: "text", person: PEOPLE.ken, rating: 5, tint: 2, big: true, text: "Our first video testimonial was live twenty minutes after install." },
  { kind: "text", person: PEOPLE.leila, rating: 4, tint: 3, text: "Two of my students recorded straight from their phones the same evening." },
  { kind: "video", video: byId("daniel"), shape: "square", focus: "48% 30%" },
  { kind: "text", person: PEOPLE.jordan, rating: 5, tint: 4, text: "Short, honest clips from members do more than any ad I've run.", phone: false },
  { kind: "text", person: PEOPLE.theo, rating: 5, tint: 5, big: true, text: "Clients see real faces before they book a call. That changed everything." },
  { kind: "video", video: byId("grace"), shape: "tall", focus: "77% 30%" },
  { kind: "text", person: PEOPLE.grace, rating: 5, tint: 1, text: "The dark theme matched our site without touching a line of code.", phone: false },
];

export const PLATFORMS = ["WordPress", "Webflow", "Framer", "Shopify", "Ghost", "Squarespace", "Wix", "Next.js", "Plain HTML"];

export const STEPS = [
  {
    key: "ask",
    title: "Share a link",
    body: "Create a project and send its link after a purchase, a call or a launch. Customers rate you, then write a few lines or record a short video on any phone or laptop. Nothing to install.",
  },
  {
    key: "approve",
    title: "Approve the keepers",
    body: "Everything lands in a review queue first. Approve the best, reject the rest, tidy up a name and tag them by page or product. Nothing goes public without you.",
  },
  {
    key: "show",
    title: "Embed anywhere",
    body: "Paste one script tag or an iframe into your site, or share your wall of love. Your CSS can't break it, and it ships in light and dark.",
  },
] as const;

/** The real widget layouts (src/lib/widget-config.ts LAYOUTS) shown in the studio preview. */
export const LAYOUTS = [
  { id: "grid", label: "Masonry" },
  { id: "carousel", label: "Carousel" },
  { id: "slider", label: "Slider" },
  { id: "marquee", label: "Marquee" },
  { id: "featured", label: "Featured" },
] as const;
export type StudioLayout = (typeof LAYOUTS)[number]["id"];

export const SNIPPET = `<script src="https://plaudit.yoursite.com/widget.js" data-widget="your-widget-id" async></script>`;

export const SETUP = [
  `git clone ${REPO}.git plaudit`,
  "cd plaudit && cp .env.example .env",
  "docker compose up -d --build",
];

export const FEATURES = {
  record: { title: "Record in the browser", body: "Camera, mic, preview, re-take. Or upload a file. Works on phones and laptops." },
  queue: { title: "A real moderation queue", body: "Approve, reject, rename and tag before anything goes live." },
  wall: { title: "Wall of love", body: "A shareable page of your approved testimonials." },
  embed: { title: "Embed anywhere", body: "Script or iframe. Light, dark or follow the visitor." },
  tracking: {
    title: "No third-party tracking",
    body: "Widgets talk only to your server. Their view counts are cookieless, and one setting turns them off.",
  },
  unlimited: { title: "Unlimited testimonials", body: "No caps, and nothing hidden behind a plan." },
} as const;

export const COMPARE = [
  ["Testimonials you can collect", "Unlimited", "Often capped on free plans"],
  ["Remove vendor branding", "Always, it's your app", "Usually a paid tier"],
  ["Where videos and emails live", "Your server", "The vendor's cloud"],
  ["Visitor tracking in widgets", "Cookieless counts on your server, or none", "Often includes analytics beacons"],
  ["Source code", "MIT licensed", "Closed"],
  ["Price", "Free (you pay for hosting)", "Monthly subscription"],
  ["Server to maintain", "Yes, one container", "No, it's hosted for you"],
] as const;

export const FAQ = [
  {
    q: "Is it really free?",
    a: "Yes. Plaudit is MIT licensed. You can run it, change it and ship it with your product. Your only cost is the server you run it on.",
  },
  {
    q: "What do I need to run it?",
    a: "Docker, or Node.js 22. `docker compose up` starts the app with SQLite and stores everything in a single volume you can back up.",
  },
  {
    q: "Where are videos stored?",
    a: "On your server's disk, inside the data volume. Or point it at any S3-compatible bucket, such as Cloudflare R2, AWS S3 or MinIO.",
  },
  {
    q: "Does the widget track my visitors?",
    a: "Not with cookies, and never for anyone else. The widget asks your Plaudit server for approved testimonials and tells it about a view. Visitors are counted with a hash that changes every day; no IP address or user agent is kept, and ANALYTICS=off stops it altogether.",
  },
  {
    q: "Will the widget clash with my site's styles?",
    a: "No. The script widget renders inside a Shadow DOM, so your CSS can't break it and its CSS can't leak out. Prefer an iframe? That's included too.",
  },
  {
    q: "Can customers record on their phone?",
    a: "Yes. Modern mobile browsers can record directly on the collection page, and anyone can upload a video file instead.",
  },
] as const;
