import { z } from "zod";
import { env } from "../../env";
import { cleanLine, cleanText, httpUrl, parseJson, parseSourceDate, pick } from "../html";
import { reviewsFromPage } from "../jsonld-reviews";
import { ImporterBlockedError, ImporterInputError, type ImportedReview, type ImporterAdapter } from "../types";
import { fetchHtml } from "./_page";

/**
 * Product Hunt. With the owner's own PRODUCT_HUNT_TOKEN it reads a launch's
 * comments through the official GraphQL API v2 (the public API exposes
 * comments, not product reviews). Without one it reads the schema.org
 * reviews on the product's public reviews page, with the saved-page upload
 * when that's blocked.
 */

const input = z
  .object({ url: z.string().trim().min(1, "Paste your Product Hunt launch or product page").max(500) })
  .transform((v, ctx) => {
    const m = /producthunt\.com\/(posts|products)\/([a-z0-9][a-z0-9-]*)/i.exec(v.url);
    const slug = m?.[2] ?? (/^[a-z0-9][a-z0-9-]*$/i.test(v.url) ? v.url : null);
    if (!slug) {
      ctx.addIssue({ code: "custom", message: "Use a Product Hunt link, like https://www.producthunt.com/posts/your-launch" });
      return z.NEVER;
    }
    return { kind: (m?.[1]?.toLowerCase() ?? "posts") as "posts" | "products", slug: slug.toLowerCase() };
  });
type Input = z.output<typeof input>;

const QUERY = `query PlauditImport($slug: String!, $after: String) {
  post(slug: $slug) {
    id name url
    comments(first: 20, after: $after) {
      pageInfo { endCursor hasNextPage }
      edges { node { id body createdAt url user { name headline profileImage username } } }
    }
  }
}`;

type Obj = Record<string, unknown>;

export function parseComments(json: unknown): { items: ImportedReview[]; next: string | null } {
  const post = pick((json ?? {}) as Obj, "data.post") as Obj | undefined;
  if (!post) return { items: [], next: null };
  const edges = (pick(post, "comments.edges") as Obj[] | undefined) ?? [];
  const items: ImportedReview[] = [];
  for (const edge of edges) {
    const n = (edge.node ?? {}) as Obj;
    if (typeof n.id !== "string" && typeof n.id !== "number") continue;
    items.push({
      sourceReviewId: String(n.id),
      authorName: cleanLine(pick(n, "user.name", "user.username")) ?? "Product Hunt user",
      authorTitle: cleanLine(pick(n, "user.headline")),
      avatarUrl: httpUrl(pick(n, "user.profileImage")),
      text: cleanText(n.body),
      url: httpUrl(n.url) ?? httpUrl(post.url),
      date: parseSourceDate(n.createdAt),
    });
  }
  const more = pick(post, "comments.pageInfo.hasNextPage") === true;
  const end = pick(post, "comments.pageInfo.endCursor");
  return { items, next: more && typeof end === "string" ? end : null };
}

export const producthunt: ImporterAdapter = {
  id: "producthunt",
  label: "Product Hunt",
  platform: "producthunt",
  kind: "platform",
  method: "api-key",
  tosNotes:
    "With your own Product Hunt API token it reads your launch’s comments through the official API. Without one it reads the reviews on your product’s public page, which Product Hunt may block; then upload the saved page. Import only your own product.",
  fields: [{ key: "url", label: "Launch or product page", placeholder: "https://www.producthunt.com/posts/your-launch" }],
  input,
  async fetchPage(raw, cursor, ctx) {
    const i = raw as Input;
    if (env.productHuntToken && i.kind === "posts") {
      const res = await ctx.fetchText(`${ctx.origin("https://api.producthunt.com")}/v2/api/graphql`, {
        method: "POST",
        body: JSON.stringify({ query: QUERY, variables: { slug: i.slug, after: cursor } }),
        headers: { authorization: `Bearer ${env.productHuntToken}`, accept: "application/json" },
        timeoutMs: 10_000,
        maxBytes: 2 * 1024 * 1024,
      });
      if (res.status === 401 || res.status === 403) throw new ImporterInputError("Product Hunt refused the token. Check PRODUCT_HUNT_TOKEN.");
      const json = parseJson(res.text);
      if (res.status !== 200 || json === undefined) throw new Error(`Product Hunt answered ${res.status}`);
      if (!pick(json as Obj, "data.post")) throw new ImporterInputError("Product Hunt has no launch at that link.");
      return parseComments(json);
    }
    const url = `${ctx.origin("https://www.producthunt.com")}/products/${encodeURIComponent(i.slug)}/reviews`;
    const res = await fetchHtml(ctx, url, "Product Hunt");
    const items = reviewsFromPage(res.text, res.finalUrl || url);
    if (!items.length) throw new ImporterBlockedError("We couldn't find reviews on that Product Hunt page.");
    return { items, next: null };
  },
  parseHtml: (html) => reviewsFromPage(html, "https://www.producthunt.com"),
};
