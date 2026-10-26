import { cleanLine, cleanText, httpUrl, parseSourceDate, pick, stableId, toRating } from "../html";
import { normalizePlatform } from "../../csv-import";
import type { ImportedReview } from "../types";

type Obj = Record<string, unknown>;

/** Values that name the tool's own channels rather than a review site: the adapter's platform is used instead. */
const FIRST_PARTY = new Set(["form", "manual", "import", "imported", "api", "csv", "widget", "text", "video", "senja", "shapo", "testimonialto", "testimonial-to", "collection", "wall"]);

/**
 * A testimonial-shaped object from another tool's API or page data, read
 * by the names such tools use. Their exact shapes aren't promised, so every
 * field is looked up under a few names, and anything odd is left out.
 */
export function reviewFromObject(
  o: Obj,
  opts: {
    date?: (raw: unknown) => ImportedReview["date"];
    /** What a bare "title" means in this tool: the testimonial's headline (Senja) or the person's job title (most others). */
    title?: "headline" | "job";
  } = {},
): ImportedReview | null {
  const name = cleanLine(pick(o, "customer_name", "customerName", "name", "author_name", "authorName", "full_name", "fullName", "user_name", "userName", "customer.name", "author.name", "user.name"));
  const text = cleanText(pick(o, "text", "testimonial", "message", "content", "body", "review", "reviewBody", "quote", "feedback"));
  const video =
    httpUrl(pick(o, "video_url", "videoUrl", "video_mp4_url", "videoMp4Url", "video.mp4_urls.high", "video.mp4_urls.medium", "video.url", "video")) ??
    httpUrl((Array.isArray(o.media) ? (o.media as Obj[]).find((m) => m?.type === "video")?.url : undefined) as string | undefined);
  if (!name || (!text && !video)) return null;
  const rawDate = pick(o, "date", "created_at", "createdAt", "submitted_at", "submittedAt", "published_at");
  const id = pick(o, "id", "_id", "uuid", "testimonial_id", "testimonialId");
  return {
    sourceReviewId: typeof id === "string" || typeof id === "number" ? String(id) : stableId(name, String(rawDate ?? ""), text ?? video ?? ""),
    authorName: name,
    authorTitle: cleanLine(pick(o, "customer_tagline", "tagline", "job_title", "jobTitle", "position", "customer.title", ...(opts.title === "headline" ? [] : ["title"]))),
    authorCompany: cleanLine(pick(o, "customer_company", "company", "companyName", "company_name", "customer.company")),
    avatarUrl: httpUrl(pick(o, "customer_avatar", "avatar", "avatarUrl", "avatar_url", "profileImage", "profile_image", "image", "photo", "customer.avatar", "author.avatar", "user.avatar")),
    rating: toRating(pick(o, "rating", "stars", "score")),
    headline: cleanLine(pick(o, "testimonial_title", "headline", "summary", ...(opts.title === "headline" ? ["title"] : [])), 200),
    text,
    url: httpUrl(pick(o, "url", "link", "source_url", "sourceUrl", "permalink")),
    date: opts.date ? opts.date(rawDate) : parseSourceDate(rawDate),
    language: typeof o.lang === "string" ? o.lang.slice(0, 16) : typeof o.language === "string" ? o.language.slice(0, 16) : undefined,
    videoUrl: video,
    platform: platformOf(pick(o, "integration", "source", "platform")),
  };
}

function platformOf(raw: unknown) {
  const p = typeof raw === "string" ? normalizePlatform(raw) : null;
  return p && !FIRST_PARTY.has(p) ? p : undefined;
}

/** The list in an API answer: the array itself, or the first array under a usual key. */
export function listOf(json: unknown): Obj[] {
  if (Array.isArray(json)) return json.filter((x) => x && typeof x === "object") as Obj[];
  if (json && typeof json === "object") {
    for (const key of ["testimonials", "data", "items", "results", "reviews"]) {
      const v = (json as Obj)[key];
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Obj[];
      if (v && typeof v === "object") {
        const inner = listOf(v);
        if (inner.length) return inner;
      }
    }
  }
  return [];
}
