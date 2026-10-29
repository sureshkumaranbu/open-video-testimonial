import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { SocialDraft, Testimonial } from "@/db/schema";
import { env } from "../env";
import { featureOn } from "../features";
import { mediaUrl } from "../storage";

const { socialDrafts, videoRenders } = schema;

/**
 * INT-08 (M18): a social post draft for each approved testimonial, for X and
 * LinkedIn. It's made from a template when the testimonial is approved (a
 * short quote in the customer's own words, their name and role), edited in
 * the inbox drawer, and shared through each site's own share links: Plaudit
 * never posts and holds no tokens. The link (the testimonial's /t/ page) is
 * added when it's shared, so the stored text never goes stale. The
 * testimonial.approved webhook carries the draft too, for Buffer or Typefully
 * through Zapier, Make or n8n (docs/help/social-drafts.md).
 */

/** X counts every link as 23 characters, whatever its length. */
export const X_LIMIT = 280;
export const X_LINK_LENGTH = 23;
/** The most the draft's own text may be, so it and the link fit one post on X. */
export const MAX_DRAFT_CHARS = X_LIMIT - X_LINK_LENGTH - 1;

export const socialDraftBody = z.object({
  text: z.string().trim().min(1, "Write something to post").max(MAX_DRAFT_CHARS, `Keep it under ${MAX_DRAFT_CHARS} characters, so it fits on X with the link`),
  /** The editor kept a "Rewrite with AI" suggestion. */
  aiRewritten: z.boolean().optional(),
});

type Source = Pick<Testimonial, "id" | "projectId" | "status" | "text" | "transcript" | "headline" | "authorName" | "authorTitle" | "authorCompany">;

/** The customer's own words a draft may quote: the text, else the video's transcript, else the headline. */
export function wordsOf(t: Pick<Testimonial, "text" | "transcript" | "headline">): string {
  return (t.text?.trim() || t.transcript?.trim() || t.headline?.trim() || "").replace(/\s+/g, " ");
}

/** "Head of Ops at Acme", "Acme" or "". */
export function roleOf(t: Pick<Testimonial, "authorTitle" | "authorCompany">): string {
  const title = t.authorTitle?.trim();
  const company = t.authorCompany?.trim();
  return title && company ? `${title} at ${company}` : title || company || "";
}

/**
 * The start of `words` in at most `max` characters: whole sentences when the
 * first one fits, else whole words and "…". Never words the customer didn't use.
 */
export function shortQuote(words: string, max: number): string {
  const text = words.trim();
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+["”’)]*\s*/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  if (out.trim()) return out.trim();
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/u, "")}…`;
}

/** The template: “quote” — Name, role. Within MAX_DRAFT_CHARS. */
export function templateDraft(t: Pick<Testimonial, "text" | "transcript" | "headline" | "authorName" | "authorTitle" | "authorCompany">): string {
  const role = roleOf(t);
  const byline = `— ${t.authorName.trim()}${role ? `, ${role}` : ""}`.slice(0, 120);
  const words = wordsOf(t);
  if (!words) return byline.slice(0, MAX_DRAFT_CHARS);
  // Two quote marks and the line break between quote and byline.
  const room = MAX_DRAFT_CHARS - byline.length - 3;
  return `“${shortQuote(words, Math.max(room, 40))}”\n${byline}`.slice(0, MAX_DRAFT_CHARS);
}

/** Where a shared post links: the testimonial's own page. */
export const pageUrl = (t: Pick<Testimonial, "id">) => `${env.publicUrl}/t/${t.id}`;

/** X's and LinkedIn's share links (no API, no tokens): X takes the text and the link, LinkedIn the link (paste the text). */
export function shareLinks(text: string, url: string) {
  const q = encodeURIComponent;
  return {
    x: `https://x.com/intent/tweet?text=${q(text)}&url=${q(url)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${q(url)}`,
  };
}

/** M16's newest ready social clip of the testimonial, if it has one. */
export function socialClipOf(testimonialId: string) {
  return (
    getDb()
      .select({ id: videoRenders.id, key: videoRenders.key, width: videoRenders.width, height: videoRenders.height })
      .from(videoRenders)
      .where(and(eq(videoRenders.testimonialId, testimonialId), eq(videoRenders.kind, "social"), eq(videoRenders.status, "ready")))
      .orderBy(desc(videoRenders.createdAt))
      .get() ?? null
  );
}

export function getSocialDraft(testimonialId: string): SocialDraft | null {
  return getDb().select().from(socialDrafts).where(eq(socialDrafts.testimonialId, testimonialId)).get() ?? null;
}

/**
 * The approved testimonial's draft, made from the template the first time
 * (on approval, or when the drawer opens one approved before M18). null while
 * it isn't approved or `commerce` is off.
 */
export function ensureSocialDraft(t: Source): SocialDraft | null {
  if (!featureOn("commerce") || t.status !== "approved") return null;
  const existing = getSocialDraft(t.id);
  if (existing) return existing;
  const now = new Date();
  return (
    getDb()
      .insert(socialDrafts)
      .values({ testimonialId: t.id, projectId: t.projectId, text: templateDraft(t), createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning()
      .get() ?? getSocialDraft(t.id)
  );
}

export function saveSocialDraft(t: Source, input: z.infer<typeof socialDraftBody>, by: string | null): SocialDraft {
  const now = new Date();
  const set = { text: input.text, editedBy: by, updatedAt: now, ...(input.aiRewritten ? { aiRewrittenAt: now } : {}) };
  return getDb()
    .insert(socialDrafts)
    .values({ testimonialId: t.id, projectId: t.projectId, ...set, createdAt: now })
    .onConflictDoUpdate({ target: socialDrafts.testimonialId, set })
    .returning()
    .get();
}

/** Back to the template. */
export function resetSocialDraft(t: Source): SocialDraft {
  const now = new Date();
  const set = { text: templateDraft(t), editedBy: null, aiRewrittenAt: null, updatedAt: now };
  return getDb()
    .insert(socialDrafts)
    .values({ testimonialId: t.id, projectId: t.projectId, ...set, createdAt: now })
    .onConflictDoUpdate({ target: socialDrafts.testimonialId, set })
    .returning()
    .get();
}

/**
 * The draft as the drawer and the testimonial.approved webhook show it:
 * the text, the link, both share links and the social clip (a media URL, readable with an API key).
 */
export function socialDraftView(t: Pick<Testimonial, "id">, d: SocialDraft) {
  const url = pageUrl(t);
  const clip = socialClipOf(t.id);
  return {
    text: d.text,
    url,
    /** The text and the link, as one post (what Copy copies). */
    post: `${d.text}\n\n${url}`,
    shareUrls: shareLinks(d.text, url),
    clip: clip?.key ? { renderId: clip.id, url: `${env.publicUrl}${mediaUrl(clip.key)}`, width: clip.width, height: clip.height } : null,
    edited: d.editedBy !== null,
    aiRewrittenAt: d.aiRewrittenAt?.toISOString() ?? null,
    updatedAt: d.updatedAt.toISOString(),
  };
}
export type SocialDraftView = ReturnType<typeof socialDraftView>;

/** For the testimonial.approved webhook (an additive `socialDraft` field). Never throws into the caller. */
export function approvedDraftPayload(t: Source) {
  try {
    const d = ensureSocialDraft(t);
    if (!d) return null;
    const { edited, aiRewrittenAt, updatedAt, ...v } = socialDraftView(t, d);
    void edited;
    void aiRewrittenAt;
    void updatedAt;
    return v;
  } catch (err) {
    console.error("[social] couldn't make the draft:", err);
    return null;
  }
}
