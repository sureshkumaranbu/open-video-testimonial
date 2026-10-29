import { featureOn } from "../features";
import type { FeedItem, WidgetConfig } from "../widget-config";
import { formatAmount, recentPurchases } from "./purchases";
import { getConnection } from "./stripe-connection";

/**
 * INT-07: what a sales popup widget's public feed carries. Purchases become
 * feed items with `sale` set and nothing else: the line is written here from
 * the widget's own words, with only the details the owner chose to show, so a
 * hidden name, place, product, amount or time never leaves the server. The
 * buyer's first name is all the popup ever has.
 */

/** The longest testimonial snippet a sales popup shows between purchases. */
export const SNIPPET_CHARS = 140;
const MAX_PURCHASES = 20;
const MAX_SNIPPETS = 10;

/** "{name} from {place} bought {product}" with the parts filled in; unknown braces stay as they are. */
export function fillSalesLine(template: string, parts: { name: string; place: string; product: string }) {
  return template.replace(/\{(name|place|product)\}/g, (_, k: keyof typeof parts) => parts[k]);
}

function snippet(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= SNIPPET_CHARS) return t;
  const cut = t.slice(0, SNIPPET_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > SNIPPET_CHARS / 2 ? cut.slice(0, space) : cut}…`;
}

const blank = (at: string): FeedItem["extra"] => ({
  headline: null,
  date: at,
  datePrecision: "day",
  platform: null,
  sourceUrl: null,
  verified: false,
  images: [],
  companyLogoUrl: null,
  highlights: [],
});

/** The project's recent purchases as popup items, newest first (none while `commerce` is off or Stripe isn't connected). */
export function saleItems(projectId: string, cfg: Pick<WidgetConfig, "options" | "labels">): FeedItem[] {
  if (!featureOn("commerce")) return [];
  const c = getConnection(projectId);
  if (!c || !c.enabled) return [];
  const o = cfg.options;
  const l = cfg.labels;
  return recentPurchases(projectId, { days: o.salesDays, limit: MAX_PURCHASES }).map((p, i) => {
    const name = (o.salesName && p.firstName) || l.salesSomeone;
    const place = o.salesPlace ? p.place : null;
    const product = (o.salesProduct && (p.product || c.defaultProduct)) || l.salesNoProduct;
    const at = o.salesTime ? p.purchasedAt.toISOString() : null;
    return {
      id: `sale-${i + 1}`,
      name,
      title: null,
      company: null,
      avatarUrl: null,
      rating: null,
      text: null,
      video: null,
      tags: [],
      createdAt: at ?? "",
      extra: blank(at ?? ""),
      sale: {
        line: fillSalesLine(place ? l.salesLine : l.salesLineNoPlace, { name, place: place ?? "", product }).slice(0, 200),
        amount: o.salesAmount ? formatAmount(p.amount, p.currency) : null,
        at,
      },
    };
  });
}

/**
 * The popup's items: purchases, with (when the widget mixes them in) a short
 * snippet of an approved testimonial after every two. Snippets keep only the
 * name, role, rating and the start of the words.
 */
export function salesFeed(projectId: string, cfg: Pick<WidgetConfig, "options" | "labels">, testimonials: FeedItem[]): FeedItem[] {
  const sales = saleItems(projectId, cfg);
  if (!cfg.options.salesMix) return sales;
  const snippets = testimonials
    .filter((t) => t.text?.trim())
    .slice(0, MAX_SNIPPETS)
    .map((t) => ({ ...t, text: snippet(t.text!), video: null, extra: { ...t.extra, images: [], highlights: [] } }));
  const out: FeedItem[] = [];
  let s = 0;
  sales.forEach((sale, i) => {
    out.push(sale);
    if (i % 2 === 1 && s < snippets.length) out.push(snippets[s++]);
  });
  return [...out, ...snippets.slice(s)];
}
