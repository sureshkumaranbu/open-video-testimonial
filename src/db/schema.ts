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
  /** Consent wording shown on the form; empty means the default. `{project}` is replaced. */
  consentText: text("consent_text").notNull().default(""),
  /** Invitation email. `{name}`, `{project}` and `{link}` are filled in. Empty means the default. */
  inviteSubject: text("invite_subject").notNull().default(""),
  inviteMessage: text("invite_message").notNull().default(""),
  /** Days after the invitation to send reminders, e.g. "3,7". Empty for none. */
  reminderDays: text("reminder_days").notNull().default("3,7"),
  /** Email the author a receipt (with their withdrawal link) after they submit. */
  thankYouEmail: integer("thank_you_email", { mode: "boolean" }).notNull().default(true),
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

export const TRANSCRIPT_STATUSES = ["none", "queued", "processing", "ready", "failed"] as const;
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

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
    /** Plain-text transcript of the video (machine-made, owner-editable). */
    transcript: text("transcript"),
    /** WebVTT captions shown on every player. */
    captionsVtt: text("captions_vtt"),
    transcriptStatus: text("transcript_status", { enum: TRANSCRIPT_STATUSES }).notNull().default("none"),
    transcriptError: text("transcript_error"),
    /** JSON array of what the author agreed to, e.g. ["website","social"]. */
    consentScopes: text("consent_scopes").notNull().default('["website"]'),
    /** Set when the owner changes what the author wrote after they consented. */
    editedAfterConsent: integer("edited_after_consent", { mode: "boolean" }).notNull().default(false),
    /** Set when the author withdraws consent through their private link. */
    withdrawnAt: integer("withdrawn_at", { mode: "timestamp_ms" }),
    withdrawTokenHash: text("withdraw_token_hash"),
    /** Set when the testimonial came in through a personal request link. */
    requestId: text("request_id"),
    consentAt: integer("consent_at", { mode: "timestamp_ms" }).notNull(),
    source: text("source").notNull().default("form"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [
    index("testimonials_project_status_idx").on(t.projectId, t.status),
    // /api/media looks up which testimonial a file belongs to on every request.
    index("testimonials_avatar_key_idx").on(t.avatarKey),
    index("testimonials_video_key_idx").on(t.videoKey),
    index("testimonials_video_original_key_idx").on(t.videoOriginalKey),
    index("testimonials_poster_key_idx").on(t.posterKey),
  ],
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

/**
 * Every consent wording a project has used. A submission records the exact
 * version the person saw, so the wording can be shown later even if the
 * owner has since changed it.
 */
export const consentVersions = sqliteTable(
  "consent_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    text: text("text").notNull(),
    /** SHA-256 of `text`, so a printed record can be matched to the wording. */
    hash: text("hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("consent_versions_project_version_idx").on(t.projectId, t.version)],
);

export const CONSENT_EVENT_TYPES = ["granted", "edited", "withdrawn", "imported"] as const;
export type ConsentEventType = (typeof CONSENT_EVENT_TYPES)[number];
export const CONSENT_ACTORS = ["customer", "owner", "api", "import"] as const;

/** Append-only consent history. Rows are only ever inserted. */
export const consentEvents = sqliteTable(
  "consent_events",
  {
    id: text("id").primaryKey(),
    testimonialId: text("testimonial_id")
      .notNull()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    type: text("type", { enum: CONSENT_EVENT_TYPES }).notNull(),
    actor: text("actor", { enum: CONSENT_ACTORS }).notNull(),
    versionId: text("version_id").references(() => consentVersions.id, { onDelete: "set null" }),
    /** The exact wording at the time (copied, so it survives later edits). */
    text: text("text"),
    textHash: text("text_hash"),
    scopes: text("scopes"),
    /** Keyed hash of the client IP, only when CONSENT_IP_HASH=true. */
    ipHash: text("ip_hash"),
    detail: text("detail"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [index("consent_events_testimonial_idx").on(t.testimonialId)],
);

export const REQUEST_STATUSES = ["waiting", "responded", "unsubscribed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const EMAIL_STATUSES = ["not_sent", "queued", "sent", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** A personal invitation to leave a testimonial, with a prefilled link and reminders. */
export const requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email").notNull(),
    company: text("company"),
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("waiting"),
    emailStatus: text("email_status", { enum: EMAIL_STATUSES }).notNull().default("not_sent"),
    emailError: text("email_error"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    remindersSent: integer("reminders_sent").notNull().default(0),
    nextReminderAt: integer("next_reminder_at", { mode: "timestamp_ms" }),
    respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
    testimonialId: text("testimonial_id").references(() => testimonials.id, { onDelete: "set null" }),
    unsubscribedAt: integer("unsubscribed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [
    index("requests_project_idx").on(t.projectId),
    index("requests_reminder_idx").on(t.status, t.nextReminderAt),
  ],
);

export const API_KEY_SCOPES = ["read", "write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Keys for the REST API. Only a hash is stored; the key is shown once. */
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** First characters of the key, to recognise it in the list. */
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scope: text("scope", { enum: API_KEY_SCOPES }).notNull().default("read"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

export const WEBHOOK_EVENTS = [
  "testimonial.created",
  "testimonial.approved",
  "testimonial.rejected",
  "testimonial.deleted",
  "testimonial.transcribed",
  "consent.withdrawn",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "ping";

/** Outgoing webhooks, signed with a per-endpoint secret. */
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  /** HMAC-SHA256 signing secret (needed in full to sign, so stored as-is). */
  secret: text("secret").notNull(),
  /** JSON array of event names; empty means every event. */
  events: text("events").notNull().default("[]"),
  /** Only this project's events, or every project when null. */
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const DELIVERY_STATUSES = ["pending", "success", "failed"] as const;

/** One attempt log per event sent to a webhook (retries update the same row). */
export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt)],
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

export const MEMBER_ROLES = ["owner", "admin"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * People invited to the dashboard from Settings → Team. The owner (ADMIN_EMAIL)
 * and anyone allowed by ADMIN_EMAILS or ALLOWED_EMAIL_DOMAINS can sign in
 * without a row here; a row is added for them on first sign-in.
 */
export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  /** Lower-cased. */
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", { enum: MEMBER_ROLES }).notNull().default("admin"),
  /** Who sent the invitation, if anyone. */
  invitedBy: text("invited_by"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
  lastSignInAt: integer("last_sign_in_at", { mode: "timestamp_ms" }),
});

export const LOGIN_TOKEN_PURPOSES = ["sign-in", "invite"] as const;
export type LoginTokenPurpose = (typeof LOGIN_TOKEN_PURPOSES)[number];

/** Single-use email links (sign-in and invitations), stored as hashes. */
export const loginTokens = sqliteTable(
  "login_tokens",
  {
    id: text("id").primaryKey(),
    /** SHA-256 of the token in the link. */
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email").notNull(),
    purpose: text("purpose", { enum: LOGIN_TOKEN_PURPOSES }).notNull(),
    /** SHA-256 of a cookie set in the browser that asked for the link; null for invitations. */
    browserHash: text("browser_hash"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("login_tokens_email_idx").on(t.email)],
);

/** In-progress Google and Apple sign-ins: state, nonce and PKCE verifier, bound to a browser cookie. */
export const oauthFlows = sqliteTable("oauth_flows", {
  /** Random; the browser that started the sign-in holds it in a cookie. */
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  state: text("state").notNull().unique(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  /** Apple posts the result back cross-site; it waits here until the browser follows the redirect. */
  code: text("code"),
  userJson: text("user_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export type Member = typeof members.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Testimonial = typeof testimonials.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type ConsentVersion = typeof consentVersions.$inferSelect;
export type ConsentEvent = typeof consentEvents.$inferSelect;
export type TestimonialRequest = typeof requests.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
