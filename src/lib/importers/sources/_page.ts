import type { z } from "zod";
import { looksBlocked } from "../html";
import { reviewsFromPage } from "../jsonld-reviews";
import { ImporterBlockedError, ImporterInputError, type AdapterId, type ImportCtx, type ImportedReview, type ImporterAdapter, type InputField } from "../types";

/**
 * Shared by the adapters that read a public review page (Trustpilot, G2,
 * Capterra…): fetch it with the guard's caps, tell a bot wall from a missing
 * page, and read the schema.org reviews on it. When a site blocks us the
 * owner can upload the page saved from their browser, parsed the same way.
 */

export async function fetchHtml(ctx: ImportCtx, url: string, label: string) {
  const res = await ctx.fetchText(url, {
    timeoutMs: 12_000,
    maxBytes: 8 * 1024 * 1024,
    headers: { accept: "text/html,application/xhtml+xml", "accept-language": "en" },
  });
  if (res.status === 404 || res.status === 410) throw new ImporterInputError(`${label} has no page at that address. Check the link.`);
  if (looksBlocked(res.status, res.text)) throw new ImporterBlockedError(`${label} didn't let Plaudit read the page.`);
  if (res.status < 200 || res.status >= 300) throw new Error(`${label} answered ${res.status}`);
  return res;
}

export type ReviewSiteSpec<I> = {
  id: AdapterId;
  label: string;
  tosNotes: string;
  fields: InputField[];
  input: z.ZodType<I>;
  /** The real site's origin; IMPORTER_ORIGINS swaps it in tests. */
  origin: string;
  /** Path and query of page `page` (1-based). */
  path(input: I, page: number): string;
  /** Most pages one run reads. */
  maxPages: number;
  /** Reads a page; defaults to the schema.org reviews on it. */
  parse?(html: string, url: string): { items: ImportedReview[]; lastPage?: number };
};

export function reviewSite<I>(spec: ReviewSiteSpec<I>): ImporterAdapter {
  const parse: NonNullable<ReviewSiteSpec<I>["parse"]> = spec.parse ?? ((html, url) => ({ items: reviewsFromPage(html, url) }));
  return {
    id: spec.id,
    label: spec.label,
    platform: spec.id,
    kind: "platform",
    method: "structured-data",
    tosNotes: spec.tosNotes,
    fields: spec.fields,
    input: spec.input as z.ZodType<unknown>,
    async fetchPage(raw, cursor, ctx) {
      const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
      const url = `${ctx.origin(spec.origin)}${spec.path(raw as I, page)}`;
      const res = await fetchHtml(ctx, url, spec.label);
      const { items, lastPage } = parse(res.text, res.finalUrl || url);
      if (page === 1 && items.length === 0) {
        throw new ImporterBlockedError(`We couldn't find reviews on that ${spec.label} page.`);
      }
      const last = Math.min(lastPage ?? spec.maxPages, spec.maxPages);
      return { items, next: items.length > 0 && page < last ? String(page + 1) : null };
    },
    parseHtml(html) {
      return parse(html, spec.origin).items;
    },
  };
}
