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
  /** Prompts shown beside the form and over the camera while recording, one per line. */
  questions: text("questions").notNull().default(""),
  /** Recording length limit for the in-browser recorder. */
  maxVideoSeconds: integer("max_video_seconds").notNull().default(120),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const TESTIMONIAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

/**
 * Video processing state. "ready" means a web-safe MP4 and a poster exist;
 * "skipped" means ffmpeg isn't installed, so the original file is served.
 */
export const MEDIA_STATUSES = ["none", "queued", "processing", "ready", "failed", "skipped"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

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
    /** The file as uploaded. Kept after processing so it can be re-processed. */
    videoOriginalKey: text("video_original_key"),
    posterKey: text("poster_key"),
    videoDurationMs: integer("video_duration_ms"),
    videoWidth: integer("video_width"),
    videoHeight: integer("video_height"),
    mediaStatus: text("media_status", { enum: MEDIA_STATUSES }).notNull().default("none"),
    mediaError: text("media_error"),
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

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;

/** Background work (video processing, email, webhooks) run by the in-process worker. */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    /** JSON-encoded handler input. */
    payload: text("payload").notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: integer("run_at", { mode: "timestamp_ms" }).notNull().default(now),
    /** A running job whose lock has expired is treated as crashed and retried. */
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("jobs_status_run_at_idx").on(t.status, t.runAt)],
);

export const UPLOAD_KINDS = ["video", "import"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/**
 * Resumable upload sessions. Bytes are appended in order to a part file
 * under DATA_DIR/tmp until the upload is claimed by a submission or import.
 */
export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: UPLOAD_KINDS }).notNull(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  /** SHA-256 of the bearer token handed to the uploader. */
  tokenHash: text("token_hash").notNull(),
  received: integer("received").notNull().default(0),
  maxBytes: integer("max_bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export type Project = typeof projects.$inferSelect;
export type Testimonial = typeof testimonials.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
