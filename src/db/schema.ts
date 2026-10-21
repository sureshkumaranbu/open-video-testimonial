import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;

/** A project is one product/brand that collects testimonials. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Question shown at the top of the collection page. */
  prompt: text("prompt").notNull(),
  thankYouMessage: text("thank_you_message").notNull(),
  /** Hex colour used for buttons/accents on public pages. */
  accentColor: text("accent_color").notNull().default("#0f766e"),
  allowVideo: integer("allow_video", { mode: "boolean" }).notNull().default(true),
  allowText: integer("allow_text", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const TESTIMONIAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

export const testimonials = sqliteTable(
  "testimonials",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", { enum: TESTIMONIAL_STATUSES }).notNull().default("pending"),
    /** 1-5, or null when the author skipped the rating. */
    rating: integer("rating"),
    text: text("text"),
    authorName: text("author_name").notNull(),
    /** Private: never exposed by public endpoints. */
    authorEmail: text("author_email"),
    authorTitle: text("author_title"),
    authorCompany: text("author_company"),
    avatarKey: text("avatar_key"),
    videoKey: text("video_key"),
    videoMime: text("video_mime"),
    consentAt: integer("consent_at", { mode: "timestamp_ms" }).notNull(),
    source: text("source").notNull().default("form"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("testimonials_project_status_idx").on(t.projectId, t.status)],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tags_project_name_idx").on(t.projectId, t.name)],
);

export const testimonialTags = sqliteTable(
  "testimonial_tags",
  {
    testimonialId: text("testimonial_id")
      .notNull()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.testimonialId, t.tagId] })],
);

export type Project = typeof projects.$inferSelect;
export type Testimonial = typeof testimonials.$inferSelect;
