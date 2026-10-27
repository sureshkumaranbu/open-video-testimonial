import type { Project } from "@/db/schema";
import { env } from "../env";
import type { TestimonialWithTags } from "../testimonials";

/**
 * What a chat message says about one testimonial (INT-02): who, the stars,
 * the quote and a link to review and approve it. Each chat service gets the
 * same facts in its own format; user text is escaped for each one so a quote
 * can't add links, mentions or markup.
 */
export type NotifyMessage = {
  title: string;
  projectName: string;
  author: string;
  /** "Head of growth, Acme" or "". */
  byline: string;
  rating: number | null;
  quote: string;
  /** Opens the testimonial in the dashboard, where it can be approved. */
  url: string;
  linkLabel: string;
};

const QUOTE_MAX = 500;

export function stars(rating: number | null | undefined) {
  if (!rating || rating < 1) return "";
  const n = Math.min(5, Math.round(rating));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function clip(s: string, max: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The dashboard link for one testimonial: the inbox opens it in the drawer. */
export function reviewUrl(projectId: string, testimonialId: string) {
  return `${env.publicUrl}/admin/projects/${encodeURIComponent(projectId)}?open=${encodeURIComponent(testimonialId)}`;
}

export function buildMessage(project: Pick<Project, "id" | "name">, t: TestimonialWithTags, event: string): NotifyMessage {
  const author = clip(t.authorName || "Someone", 120);
  const quote = t.text ? clip(t.text, QUOTE_MAX) : t.transcript ? clip(t.transcript, QUOTE_MAX) : t.videoKey ? "(A video testimonial)" : "";
  const approved = event === "testimonial.approved";
  return {
    title: approved ? `Testimonial approved for ${clip(project.name, 80)}` : `New testimonial for ${clip(project.name, 80)}`,
    projectName: clip(project.name, 80),
    author,
    byline: clip([t.authorTitle, t.authorCompany].filter(Boolean).join(", "), 160),
    rating: t.rating ?? null,
    quote,
    url: reviewUrl(project.id, t.id),
    linkLabel: t.status === "pending" ? "Review and approve" : "Open in Plaudit",
  };
}

/** The message a channel's Test button sends. */
export function testMessage(projectName: string | null): NotifyMessage {
  return {
    title: "Plaudit is connected",
    projectName: projectName ?? "All projects",
    author: "Plaudit",
    byline: "",
    rating: 5,
    quote: "This is a test message. New testimonials will appear here like this.",
    url: `${env.publicUrl}/admin`,
    linkLabel: "Open Plaudit",
  };
}

const who = (m: NotifyMessage) => (m.byline ? `${m.author} (${m.byline})` : m.author);

// ------------------------------------------------------------------ Slack

/** Slack mrkdwn treats &, < and > as control characters. */
const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function formatSlack(m: NotifyMessage): object {
  const rating = stars(m.rating);
  const quote = m.quote ? slackEscape(m.quote).split("\n").map((l) => `>${l}`).join("\n") : "";
  return {
    text: slackEscape(`${m.title}: ${rating ? `${rating} ` : ""}from ${who(m)}`),
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${slackEscape(m.title)}*${rating ? `\n${rating}` : ""}${quote ? `\n${quote}` : ""}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `— ${slackEscape(who(m))}` }] },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: m.linkLabel }, url: m.url }] },
    ],
  };
}

// ---------------------------------------------------------------- Discord

/** Backslash-escapes Discord markdown so a quote shows as written. */
const discordEscape = (s: string) => s.replace(/([\\*_~`|>#\[\]()-])/g, "\\$1").replace(/@/g, "@\u200b");

export function formatDiscord(m: NotifyMessage): object {
  const rating = stars(m.rating);
  return {
    username: "Plaudit",
    // Never ping anyone, whatever the quote says.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: m.title.slice(0, 256),
        url: m.url,
        description: [rating, m.quote ? discordEscape(m.quote) : ""].filter(Boolean).join("\n").slice(0, 4000),
        color: 0xf5b301,
        footer: { text: who(m).slice(0, 2048) },
      },
    ],
  };
}

// ---------------------------------------------------------------- Teams

/** Adaptive Card TextBlocks understand a little markdown (links, bold, lists): backslash-escape it. */
const teamsEscape = (s: string) => s.replace(/([\\*_\[\]()#+\-`>~|!])/g, "\\$1");

/** Teams Workflows (and the older connectors) take an Adaptive Card. */
export function formatTeams(m: NotifyMessage): object {
  const rating = stars(m.rating);
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: teamsEscape(m.title), weight: "Bolder", size: "Medium", wrap: true },
            ...(rating ? [{ type: "TextBlock", text: rating, color: "Warning", wrap: false }] : []),
            ...(m.quote ? [{ type: "TextBlock", text: `“${teamsEscape(m.quote)}”`, wrap: true, isSubtle: false }] : []),
            { type: "TextBlock", text: `— ${teamsEscape(who(m))}`, wrap: true, isSubtle: true, spacing: "Small" },
          ],
          actions: [{ type: "Action.OpenUrl", title: m.linkLabel, url: m.url }],
        },
      },
    ],
  };
}

// --------------------------------------------------------------- Telegram

const htmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sendMessage body, minus chat_id. The link is in the text: Telegram refuses buttons with local addresses. */
export function formatTelegram(m: NotifyMessage): object {
  const rating = stars(m.rating);
  const lines = [
    `<b>${htmlEscape(m.title)}</b>`,
    rating,
    m.quote ? `<i>“${htmlEscape(m.quote)}”</i>` : "",
    `— ${htmlEscape(who(m))}`,
    `<a href="${htmlEscape(m.url)}">${htmlEscape(m.linkLabel)}</a>`,
  ].filter(Boolean);
  return { text: lines.join("\n").slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true };
}
