import { z } from "zod";
import type { DatePrecision } from "@/db/schema";
import type { fetchPublicText } from "../net-guard";

/**
 * The contract every importer follows (IMP-01): adding a source is one
 * adapter file in sources/, an icon in public/importers/ and a fixture.
 * Adapters only fetch and normalise; run.ts does filtering, dedupe, saving,
 * progress and events, so every source behaves the same.
 */

export const ADAPTER_IDS = [
  "google",
  "trustpilot",
  "g2",
  "capterra",
  "producthunt",
  "appstore",
  "googleplay",
  "x",
  "testimonial-to",
  "senja",
  "shapo",
  "website",
  // M13 (PRD §8.2 P1), behind the imports2 flag.
  "yelp",
  "facebook",
  "linkedin",
  "youtube",
  "reddit",
  "tripadvisor",
  "appsumo",
  "udemy",
  "shopify",
  "woocommerce",
  "etsy",
  "amazon",
  "clutch",
  "fiverr",
  "airbnb",
  "zillow",
  "realtor",
  "chromewebstore",
  "wordpress",
  "applepodcasts",
  "feefo",
  "trustindex",
] as const;
export type AdapterId = (typeof ADAPTER_IDS)[number];

/** "saved-page": the site needs a login or blocks automated visits, so only a copy saved from the owner's browser is read. */
export const IMPORT_METHODS = ["official-api", "feed", "structured-data", "page-parse", "oembed", "file", "api-key", "saved-page"] as const;
export type ImportMethod = (typeof IMPORT_METHODS)[number];

/** One review or testimonial as a source gave it, before any of the owner's options apply. */
export interface ImportedReview {
  /** The source's own id (or a stable hash when it has none): the dedupe key with the platform. */
  sourceReviewId: string;
  authorName: string;
  authorTitle?: string;
  authorCompany?: string;
  avatarUrl?: string;
  /** 1–5 whole stars. */
  rating?: number;
  headline?: string;
  /** Plain text: adapters strip markup before it gets here. */
  text?: string;
  /** Where the review can be read. */
  url?: string;
  date?: { value: Date; precision: DatePrecision };
  language?: string;
  /** A video file to download through import.media (migrations). */
  videoUrl?: string;
  imageUrls?: string[];
  /** Where it was first posted, when a migration knows (a Senja row that came from Google). Defaults to the adapter's platform. */
  platform?: string;
}

/** One input box on the "identify" step. The adapter's `input` schema reads the same keys. */
export type InputField = {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  type?: "text" | "url" | "password" | "textarea";
  /** Optional fields may be left empty (e.g. an API key when a file upload is the other way in). */
  optional?: boolean;
};

export type ImportCtx = {
  /** The real site's origin, or the test stand-in from IMPORTER_ORIGINS. */
  origin(defaultOrigin: string): string;
  fetchText: typeof fetchPublicText;
  /** The most items the caller wants from this call. */
  limit: number;
};

export type FetchPage = { items: ImportedReview[]; next: string | null; total?: number };

export interface ImporterAdapter {
  id: AdapterId;
  label: string;
  platform: string;
  kind: "platform" | "migration";
  method: ImportMethod;
  /** Shown before the owner imports: what we read and what the site's terms say about it. */
  tosNotes: string;
  /** What to type on the identify step. */
  fields: InputField[];
  input: z.ZodType<unknown>;
  /** A reason the adapter can't run here (e.g. "Needs GOOGLE_PLACES_API_KEY"), or null. */
  unavailable?(): string | null;
  /** Hidden from the source picker (website is the onboarding wizard's). */
  unlisted?: boolean;
  /** Listed only while this feature flag is on (M13's sources: imports2). */
  feature?: "imports2";
  /** Only a saved copy of the page can be read (no identify step, no auto-sync). */
  savedPageOnly?: boolean;
  fetchPage(input: unknown, cursor: string | null, ctx: ImportCtx): Promise<FetchPage>;
  /** The "Upload the saved page instead" fallback. */
  parseHtml?(html: string): ImportedReview[];
  /** An export file (CSV) from the source, mapped with a preset. */
  parseFile?(text: string): ImportedReview[];
  /** What the upload box accepts, when the adapter takes a file. */
  upload?: { accept: string; label: string };
}

/**
 * Thrown when a site refuses to show us the page (bot protection, a login
 * wall). The dashboard then offers the saved-page upload.
 */
export class ImporterBlockedError extends Error {
  readonly code = "blocked";
}

/** The input can't be used (no such app, a malformed URL): the owner fixes it. */
export class ImporterInputError extends Error {
  readonly code = "input";
}

/** The owner's import options. */
export const importOptionsSchema = z.object({
  minRating: z.number().int().min(1).max(5).nullable().default(null),
  skipEmpty: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(32)).max(10).default([]),
  status: z.enum(["approved", "pending"]).default("pending"),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;
export type ImportOptionsInput = z.input<typeof importOptionsSchema>;

/** What the preview list shows for one item, as JSON. */
export type PreviewItem = {
  id: string;
  authorName: string;
  authorTitle: string | null;
  authorCompany: string | null;
  avatarUrl: string | null;
  rating: number | null;
  headline: string | null;
  text: string | null;
  url: string | null;
  date: string | null;
  datePrecision: DatePrecision;
  language: string | null;
  videoUrl: string | null;
  platform: string;
  /** This project already has it (the dedupe key matches). */
  alreadyImported: boolean;
};

/** Most items one run imports ("Import all matching"). */
export const MAX_IMPORT_ITEMS = 1000;
/** Items shown in the preview, and the page size of the background job. */
export const PREVIEW_SIZE = 50;
