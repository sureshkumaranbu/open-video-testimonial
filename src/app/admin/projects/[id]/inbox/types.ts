import { platformLabel } from "@/components/PlatformIcon";
import type { InboxTab } from "@/lib/inbox-query";
import type { AdminTestimonial } from "../Dashboard";

/** A row of the inbox as the list route sends it (lib/inbox.ts InboxItem, dates as ISO strings). */
export type InboxRow = AdminTestimonial & {
  updatedAt: string;
  formId: string | null;
  primaryQuestion: string | null;
  customFields: string;
  hiddenFields: string;
  headline: string | null;
  platform: string | null;
  source: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  language: string | null;
  wordCount: number | null;
  companyLogoKey: string | null;
  authorWebsite: string | null;
  datePrecision: "day" | "month" | "year";
  consentPublic: boolean;
  trashedAt: string | null;
  answerCount: number;
  answerVideoCount: number;
  imageCount: number;
};

export type InboxCounts = Record<InboxTab, number>;
export type InboxStats = { pending: number; approved: number; video: number };
export type InboxFacetsJson = { tags: string[]; forms: { id: string; name: string }[]; platforms: string[]; languages: string[] };

export type InboxPage = {
  items: InboxRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: InboxCounts;
  stats: InboxStats;
  facets?: InboxFacetsJson;
  /** INBOX-14: how a smart search ran (absent when it wasn't asked for). */
  search?: { mode: "smart" | "keyword"; fallback?: "off" | "failed" };
};

export type BulkResult = { updated: string[]; skipped: { id: string; reason: string }[] };

/** The tabs in the order they're shown: a 4×2 grid on phones. */
export const TAB_LABELS: { id: InboxTab; label: string; hint?: string }[] = [
  { id: "all", label: "All", hint: "Everything except the trash" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved", hint: "Public: on your wall and widgets" },
  { id: "hidden", label: "Hidden", hint: "Kept for internal use, never public" },
  { id: "rejected", label: "Rejected" },
  { id: "feedback", label: "Feedback", hint: "Private answers, never published" },
  { id: "trash", label: "Trash", hint: "Restorable for 30 days" },
];

export const EMPTY_TEXT: Record<InboxTab, string> = {
  all: "No testimonials yet. Share your collection link to get the first one.",
  pending: "Nothing to review. New testimonials show up here first.",
  approved: "Nothing approved yet. Approved testimonials appear on your wall and widgets.",
  hidden: "Nothing hidden. Hide a testimonial to keep it for internal use only.",
  rejected: "Nothing rejected.",
  feedback: "No private feedback yet.",
  trash: "The trash is empty. Deleted testimonials stay here for 30 days.",
};

/** Where a testimonial came from, for the table's source column. */
export function sourceLabel(t: Pick<InboxRow, "source" | "platform">) {
  if (t.platform) return platformLabel(t.platform);
  if (t.source === "form") return "Form";
  if (t.source === "manual") return "Added by hand";
  if (t.source === "api") return "API";
  if (t.source.startsWith("import:")) return "CSV import";
  if (t.source.startsWith("importer:")) return "Import";
  return t.source;
}
