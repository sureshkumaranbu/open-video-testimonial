import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;
// Fresh builders per call, with the same SQL as the created_at/updated_at columns below.
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(now);
const updatedAt = () => integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now);

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
  /** Approve new form submissions that match the rule below without waiting for the owner. */
  autoApprove: integer("auto_approve", { mode: "boolean" }).notNull().default(false),
  /** 4 or 5: the lowest star rating that is approved automatically. */
  autoApproveMinRating: integer("auto_approve_min_rating").notNull().default(4),
  /** Videos are harder to check at a glance, so they're included only if the owner says so. */
  autoApproveVideo: integer("auto_approve_video", { mode: "boolean" }).notNull().default(false),
  /** When auto-approve was last turned on. Testimonials sent before then are left alone. */
  autoApproveSince: integer("auto_approve_since", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
  /** The product's own site, e.g. https://acme.com. */
  website: text("website"),
  businessType: text("business_type"),
  logoKey: text("logo_key"),
  /** Brand kit {colors:{primary,background,text,button,buttonText,star}, fonts:{heading,body}}: defaults for new forms, widgets, walls. */
  brand: text("brand").notNull().default("{}"),
  /** Onboarding answers + checklist state {steps:{collect,widget,install,share}, dismissedAt}. */
  onboarding: text("onboarding").notNull().default("{}"),
  /**
   * M17: whether the server's AI provider (AI_MODEL) may be used for this
   * project's case studies, insights, surveys and OCR. Off keeps every one of
   * its testimonials away from the provider; the features fall back to their non-AI forms.
   */
  aiEnabled: integer("ai_enabled", { mode: "boolean" }).notNull().default(true),
}, (t) => [
  // /api/media checks project logos on every request.
  index("projects_logo_key_idx").on(t.logoKey),
]);

/** Hidden: approved for internal use, never public. Trashed: restorable until purged (see statusBeforeTrash). */
export const TESTIMONIAL_STATUSES = ["pending", "approved", "rejected", "hidden", "trashed"] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

/** Who approved a testimonial: someone in the dashboard, an API key, or the project's auto-approve rule. */
export const APPROVERS = ["owner", "api", "auto"] as const;
export type Approver = (typeof APPROVERS)[number];

/**
 * Video processing state. "ready" means a web-safe MP4 and a poster exist;
 * "skipped" means ffmpeg isn't installed, so the original file is served.
 */
export const MEDIA_STATUSES = ["none", "queued", "processing", "ready", "failed", "skipped"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const TRANSCRIPT_STATUSES = ["none", "queued", "processing", "ready", "failed"] as const;
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

// Phase 1 enums. Like the ones above they're TypeScript only (no SQL CHECK),
// so a new value needs no migration; existing arrays only ever grow at the end.

/** How exact a source date is: "Oct 2026" for an import that only knows the month. */
export const DATE_PRECISIONS = ["day", "month", "year"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];
export const FORM_STATUSES = ["live", "paused"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];
/** classic: today's one-page /c form (CollectForm). steps: the step-by-step runner at /f. */
export const FORM_LAYOUTS = ["classic", "steps"] as const;
export type FormLayout = (typeof FORM_LAYOUTS)[number];
/** NPS-01: a survey collects answers and an NPS score, and makes a testimonial only when a promoter opts in. */
export const FORM_KINDS = ["testimonial", "survey"] as const;
export type FormKind = (typeof FORM_KINDS)[number];
/** low-rating arrives with FORM-12 (P1); survey (NPS-01) is a survey's private question answered without a testimonial. */
export const FEEDBACK_SOURCES = ["private-question", "low-rating", "survey"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];
export const HISTORY_ACTORS = ["owner", "api", "auto", "import", "customer", "system"] as const;
export type HistoryActor = (typeof HISTORY_ACTORS)[number];
// "merged" (M13, INBOX-11): another testimonial of the same person was merged into this one, or this one into another.
// "translation" (M13, INBOX-13): a translation was added, changed or removed.
export const HISTORY_ACTIONS = ["created", "edited", "status", "tags", "trashed", "restored", "answer_edited", "highlights", "bulk", "merged", "translation"] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
export const REDIRECT_KINDS = ["project", "form", "wall", "booster"] as const;
export type RedirectKind = (typeof REDIRECT_KINDS)[number];
/** sales (M18, INT-07): the sales popup, recent purchases in a corner (flag `commerce`). */
export const WIDGET_LAYOUTS = ["grid", "list", "carousel", "slider", "marquee", "featured", "badge", "toast", "sales"] as const;
export type WidgetLayout = (typeof WIDGET_LAYOUTS)[number];
export const WIDGET_SELECTION_MODES = ["auto", "manual"] as const;
export type WidgetSelectionMode = (typeof WIDGET_SELECTION_MODES)[number];
export const SEO_SCHEMA_TYPES = ["Product", "Organization", "LocalBusiness", "SoftwareApplication", "Course"] as const;
export type SeoSchemaType = (typeof SEO_SCHEMA_TYPES)[number];
export const TASK_RUN_KINDS = ["import", "storage-migrate", "discover"] as const;
export type TaskRunKind = (typeof TASK_RUN_KINDS)[number];
export const TASK_RUN_STATUSES = ["previewed", "queued", "running", "done", "failed"] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];
/** Chat channels. Email is set per member in member_prefs. */
export const CHANNEL_TYPES = ["slack", "discord", "teams", "telegram"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const NOTIFY_FREQUENCIES = ["instant", "daily", "off"] as const;

/** What analytics counts (M11, docs/help/analytics.md). */
export const ANALYTICS_OBJECTS = ["widget", "form", "wall", "snippet", "testimonial"] as const;
export type AnalyticsObject = (typeof ANALYTICS_OBJECTS)[number];
/**
 * view: a widget, wall or form was shown. more/source/cta/play: widget clicks
 * (read more, the original review's link, the call to action, a video
 * started). link: a wall's other links. start/step/complete: a form was
 * begun, reached a page, was sent. render: a dynamic snippet was fetched.
 * share: a share button on a testimonial's own page (/t/, WALL-04).
 * dropped: events past the daily cap (counted, not stored).
 */
export const ANALYTICS_METRICS = ["view", "more", "source", "cta", "play", "link", "start", "step", "complete", "render", "share", "dropped"] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];
export type NotifyFrequency = (typeof NOTIFY_FREQUENCIES)[number];

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
    /** Set while approved: who approved it, when, and (for auto-approve) the rule, e.g. "4+ stars". */
    approvedBy: text("approved_by", { enum: APPROVERS }),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    approvalRule: text("approval_rule"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
    /** The form it was sent through; null for API, manual and imported testimonials (and once the form is deleted). */
    formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** PRD "title". Not `title`: that already means the author's job title. */
    headline: text("headline"),
    /** Review site an import came from (google, trustpilot, senja, website…). `source` keeps meaning the channel. */
    platform: text("platform"),
    sourceUrl: text("source_url"),
    /** The review's id on that platform; with `platform`, it keeps re-imports from duplicating rows. */
    sourceReviewId: text("source_review_id"),
    /** When it was first posted there (createdAt is when it arrived here). */
    sourceDate: integer("source_date", { mode: "timestamp_ms" }),
    datePrecision: text("date_precision", { enum: DATE_PRECISIONS }).notNull().default("day"),
    importedAt: integer("imported_at", { mode: "timestamp_ms" }),
    language: text("language"),
    authorWebsite: text("author_website"),
    /** Private, like authorEmail. */
    authorPhone: text("author_phone"),
    /** JSON {x, linkedin, instagram, tiktok}. */
    authorSocials: text("author_socials").notNull().default("{}"),
    companyLogoKey: text("company_logo_key"),
    /** Snapshot of the question the main text/video answers (forms change later). */
    primaryQuestion: text("primary_question"),
    /** JSON of custom field answers. Private by default. */
    customFields: text("custom_fields").notNull().default("{}"),
    /** JSON of hidden fields from the form link (utm_source…). Private. */
    hiddenFields: text("hidden_fields").notNull().default("{}"),
    isFeatured: integer("is_featured", { mode: "boolean" }).notNull().default(false),
    pinOrder: integer("pin_order"),
    /** null = not yet counted; filled on write and by the maintenance backfill. */
    wordCount: integer("word_count"),
    trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
    /** What restore puts back. */
    statusBeforeTrash: text("status_before_trash", { enum: TESTIMONIAL_STATUSES }),
    /** false only when the customer chose "keep private" on the consent page (D11). */
    consentPublic: integer("consent_public", { mode: "boolean" }).notNull().default(true),
    /**
     * VID-01 trim, in ms of the original upload: the served MP4 is re-cut from
     * the original between these (null = from the start / to the end). The
     * original is kept; captions stay in its timeline and are shifted when served.
     */
    trimStartMs: integer("trim_start_ms"),
    trimEndMs: integer("trim_end_ms"),
    /** VID-02: the frame picked as the poster, in ms of the served video; null = the default frame. */
    posterAtMs: integer("poster_at_ms"),
    /** VID-02: the poster is an uploaded image, so re-cutting the video keeps it. */
    posterCustom: integer("poster_custom", { mode: "boolean" }).notNull().default(false),
    /**
     * INBOX-11: this testimonial was merged into that one and sits in the trash.
     * Its own content is untouched (the other one got copies), so restoring it is safe.
     */
    mergedIntoId: text("merged_into_id").references((): AnySQLiteColumn => testimonials.id, { onDelete: "set null" }),
    /**
     * VID-06: the master playlist of the adaptive-streaming copy of the served
     * MP4 (`hls/<uuid>/master.m3u8`), set only while it matches the current
     * video_key; any change of video clears it. Public on the same terms as the MP4.
     */
    hlsKey: text("hls_key"),
    /**
     * INT-07 (M18): when this testimonial's email matched a purchase recorded
     * from the project's Stripe connection ("Verified purchase"). The match is
     * made on a hash; the purchase itself is deleted after its retention, this mark stays.
     */
    verifiedPurchaseAt: integer("verified_purchase_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("testimonials_project_status_idx").on(t.projectId, t.status),
    // /api/media looks up which testimonial a file belongs to on every request.
    index("testimonials_avatar_key_idx").on(t.avatarKey),
    index("testimonials_video_key_idx").on(t.videoKey),
    index("testimonials_video_original_key_idx").on(t.videoOriginalKey),
    index("testimonials_poster_key_idx").on(t.posterKey),
    index("testimonials_project_created_idx").on(t.projectId, t.createdAt),
    index("testimonials_form_idx").on(t.formId),
    index("testimonials_customer_idx").on(t.customerId),
    index("testimonials_company_logo_key_idx").on(t.companyLogoKey),
    index("testimonials_trashed_at_idx").on(t.trashedAt),
    index("testimonials_merged_into_idx").on(t.mergedIntoId),
    index("testimonials_hls_key_idx").on(t.hlsKey),
    // Import dedupe. NULLs count as distinct, so rows without a platform never clash.
    uniqueIndex("testimonials_platform_review_idx").on(t.projectId, t.platform, t.sourceReviewId),
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
  // 0016 (L12): the tag-rename trigger and tag deletes look rows up by tag.
  (t) => [primaryKey({ columns: [t.testimonialId, t.tagId] }), index("testimonial_tags_tag_idx").on(t.tagId)],
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
  (t) => [
    uniqueIndex("consent_versions_project_version_idx").on(t.projectId, t.version),
    // A form's wording is looked up by its hash before a new version is added (D12).
    index("consent_versions_project_hash_idx").on(t.projectId, t.hash),
  ],
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
  (t) => [index("consent_events_testimonial_idx").on(t.testimonialId), index("consent_events_version_idx").on(t.versionId)],
);

// "declined" (M9): the person pressed "No thanks" in a campaign email.
export const REQUEST_STATUSES = ["waiting", "responded", "unsubscribed", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
// "bounced" (M9): the mail server refused the address for good at send time.
export const EMAIL_STATUSES = ["not_sent", "queued", "sent", "failed", "bounced"] as const;
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
    /** The form the link opens; null means the project's default form. */
    formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
    // 0012 (M9): campaigns and per-recipient tracking. Timestamps only: no IPs, no user agents.
    /** The campaign this person is a recipient of; null for a request from the Requests tab. */
    campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    /** Job title, from a CSV or a customer record. */
    title: text("title"),
    /** JSON object of custom template variables ({{plan}}), string values. */
    custom: text("custom").notNull().default("{}"),
    /** When a delayed invitation is due (auto-collect); null once it's sent or when it isn't delayed. */
    scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }),
    /** First open, from the pixel of a campaign that turned open tracking on. */
    openedAt: integer("opened_at", { mode: "timestamp_ms" }),
    /** First press of the personal link (through the /r redirect). */
    clickedAt: integer("clicked_at", { mode: "timestamp_ms" }),
    /** First time the form was opened with this request's token. */
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    declinedAt: integer("declined_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("requests_project_idx").on(t.projectId),
    index("requests_reminder_idx").on(t.status, t.nextReminderAt),
    // 0011: deleting a form sets this to null.
    index("requests_form_idx").on(t.formId),
    index("requests_campaign_idx").on(t.campaignId),
    // 0016 (L12): deleting a testimonial sets this to null.
    index("requests_testimonial_idx").on(t.testimonialId),
  ],
);

export const CAMPAIGN_STATUSES = ["draft", "active", "paused"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * An email campaign (M9, REQ-01): its own wording, sender and reminder
 * schedule, sent to its recipients (rows in `requests` with this campaign_id).
 * Nothing is sent while it's a draft or paused.
 */
export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The form the personal links open; null means the project's default form. */
    formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("draft"),
    /** Shown as the sender's name, with SMTP_FROM's address. Empty uses SMTP_FROM as it is. */
    senderName: text("sender_name").notNull().default(""),
    replyTo: text("reply_to").notNull().default(""),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    buttonText: text("button_text").notNull().default(""),
    rtl: integer("rtl", { mode: "boolean" }).notNull().default(false),
    /** JSON array of up to three day offsets after the invitation, e.g. [2,5,10]. */
    reminders: text("reminders").notNull().default("[]"),
    /** The open pixel is opt-in per campaign (privacy); off by default. */
    trackOpens: integer("track_opens", { mode: "boolean" }).notNull().default(false),
    /** SHA-256 of the incoming webhook token; null while the webhook is off. */
    webhookTokenHash: text("webhook_token_hash"),
    /** First characters of the token, to recognise the URL in the dashboard. */
    webhookTokenPrefix: text("webhook_token_prefix"),
    /** 0013 (M10, REQ-08): each recipient gets their own code from the form's reward code pool. */
    rewardCodes: integer("reward_codes", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("campaigns_project_idx").on(t.projectId),
    index("campaigns_form_idx").on(t.formId),
    uniqueIndex("campaigns_webhook_token_idx").on(t.webhookTokenHash),
  ],
);

/**
 * Addresses that unsubscribed from a project's emails (M9: unsubscribe is
 * project-wide, by lower-cased email). Kept even when the request is deleted.
 */
export const unsubscribes = sqliteTable(
  "unsubscribes",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.email] })],
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
  /** 0017 (TEAM-01): false limits the key to the projects in api_key_projects. Older keys reach every project. */
  allProjects: integer("all_projects", { mode: "boolean" }).notNull().default(true),
});

export const WEBHOOK_EVENTS = [
  "testimonial.created",
  "testimonial.approved",
  "testimonial.rejected",
  "testimonial.deleted",
  "testimonial.transcribed",
  "consent.withdrawn",
  // Phase 1 (append only). widget.* arrives with install detection (P1).
  "testimonial.updated",
  "testimonial.hidden",
  "testimonial.trashed",
  "testimonial.restored",
  "feedback.created",
  "form.submitted",
  "import.completed",
  // M9 campaigns: opt-in, never in DEFAULT_EVENTS.
  "invite.sent",
  "invite.opened",
  "invite.clicked",
  "invite.declined",
  // M11 install detection (DISP-13): opt-in too.
  "widget.installed",
  "widget.removed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "ping";

/** Outgoing webhooks, signed with a per-endpoint secret. */
export const webhooks = sqliteTable(
  "webhooks",
  {
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
    /** Only this form's events (FORM-10 override), or every form when null. Deleted with the form. */
    formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),
    /** 0017: the API key that subscribed it (POST /api/v1/webhooks, Zapier's REST hooks); null when made in the dashboard. */
    apiKeyId: text("api_key_id").references((): AnySQLiteColumn => apiKeys.id, { onDelete: "set null" }),
  },
  // 0011: an index on each Phase 1 foreign key, so deleting the parent doesn't scan this table.
  (t) => [index("webhooks_form_idx").on(t.formId), index("webhooks_project_idx").on(t.projectId), index("webhooks_api_key_idx").on(t.apiKeyId)],
);

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
 * A direct session (L9, 0018) sends them to the bucket's `tmp/<id>` instead,
 * in parts through URLs the server presigns, and falls back to the part file.
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
  /** L9: the bytes go straight to the bucket (S3_DIRECT_UPLOADS). */
  direct: integer("direct", { mode: "boolean" }).notNull().default(false),
  /** The bucket's multipart upload id while parts are arriving; null once completed. */
  s3UploadId: text("s3_upload_id"),
  /** The type every presigned part is pinned to (the file's real type is sniffed on completion). */
  contentType: text("content_type"),
}, (t) => [index("uploads_project_idx").on(t.projectId)]);

/** TEAM-01 (0017, flag team2) adds editor (content, no team or settings) and viewer (read and share). */
export const MEMBER_ROLES = ["owner", "admin", "editor", "viewer"] as const;
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
  /** 0017 (TEAM-01): false limits an editor or viewer to the projects in member_projects. */
  allProjects: integer("all_projects", { mode: "boolean" }).notNull().default(true),
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

// ------------------------------------------------------------- Phase 1

/**
 * A collection form. Every project has exactly one default form (created by
 * migration 0009 for older projects); the legacy form columns on `projects`
 * mirror it (src/lib/forms/defaults.ts).
 */
export const forms = sqliteTable(
  "forms",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: FORM_STATUSES }).notNull().default("live"),
    layout: text("layout", { enum: FORM_LAYOUTS }).notNull().default("steps"),
    /** NPS-01 (M17). */
    kind: text("kind", { enum: FORM_KINDS }).notNull().default("testimonial"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    /** 0 = row created by migration 0009; pages/settings are filled from the project columns on first use. */
    configVersion: integer("config_version").notNull().default(1),
    /** JSON, src/lib/forms/schema.ts formPagesSchema (custom fields live in the about pages). */
    pages: text("pages").notNull().default("[]"),
    design: text("design").notNull().default("{}"),
    /** Owner overrides of the locale's labels only. */
    labels: text("labels").notNull().default("{}"),
    /** JSON, formSettingsSchema: auto-approve, auto-tags, confirmation email, limits… */
    settings: text("settings").notNull().default("{}"),
    /** FORM-13 (P1). */
    reward: text("reward").notNull().default("{}"),
    language: text("language").notNull().default("en"),
    logoKey: text("logo_key"),
    /** The template it was made from, if any. */
    template: text("template"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("forms_project_slug_idx").on(t.projectId, t.slug),
    uniqueIndex("forms_project_default_idx").on(t.projectId).where(sql`is_default = 1`),
    index("forms_logo_key_idx").on(t.logoKey),
  ],
);

/** Answers to questions 2..N. The first answered question stays on testimonials.text / video_* (toPublic unchanged). */
export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    testimonialId: text("testimonial_id")
      .notNull()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    /** Snapshot of the question as asked. */
    questionTitle: text("question_title").notNull(),
    position: integer("position").notNull(),
    text: text("text"),
    videoKey: text("video_key"),
    videoMime: text("video_mime"),
    videoOriginalKey: text("video_original_key"),
    posterKey: text("poster_key"),
    videoDurationMs: integer("video_duration_ms"),
    videoWidth: integer("video_width"),
    videoHeight: integer("video_height"),
    mediaStatus: text("media_status", { enum: MEDIA_STATUSES }).notNull().default("none"),
    mediaError: text("media_error"),
    transcript: text("transcript"),
    captionsVtt: text("captions_vtt"),
    transcriptStatus: text("transcript_status", { enum: TRANSCRIPT_STATUSES }).notNull().default("none"),
    transcriptError: text("transcript_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("answers_testimonial_question_idx").on(t.testimonialId, t.questionKey),
    index("answers_video_key_idx").on(t.videoKey),
    index("answers_video_original_key_idx").on(t.videoOriginalKey),
    index("answers_poster_key_idx").on(t.posterKey),
  ],
);

/** One person per project, so repeat testimonials share their details. */
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Lower-cased by code; null for imports without an email (NULLs never clash in the unique index). */
    email: text("email"),
    name: text("name").notNull(),
    title: text("title"),
    company: text("company"),
    website: text("website"),
    avatarKey: text("avatar_key"),
    socials: text("socials").notNull().default("{}"),
    custom: text("custom").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // 0018: avatar_key is indexed for L18 (which project a private file belongs to).
  (t) => [uniqueIndex("customers_project_email_idx").on(t.projectId, t.email), index("customers_avatar_key_idx").on(t.avatarKey)],
);

/** Private feedback (a private question's answer), never published. */
export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    testimonialId: text("testimonial_id").references(() => testimonials.id, { onDelete: "set null" }),
    source: text("source", { enum: FEEDBACK_SOURCES }).notNull().default("private-question"),
    rating: integer("rating"),
    text: text("text").notNull(),
    authorName: text("author_name"),
    authorEmail: text("author_email"),
    trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("feedback_project_created_idx").on(t.projectId, t.createdAt),
    index("feedback_form_idx").on(t.formId),
    index("feedback_customer_idx").on(t.customerId),
    index("feedback_testimonial_idx").on(t.testimonialId),
  ],
);

/** Images attached to an answer, or screenshots added by hand. */
export const testimonialImages = sqliteTable(
  "testimonial_images",
  {
    id: text("id").primaryKey(),
    testimonialId: text("testimonial_id")
      .notNull()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    /** null = manual add / screenshot. */
    questionKey: text("question_key"),
    key: text("key").notNull(),
    alt: text("alt"),
    position: integer("position").notNull().default(0),
    /**
     * INBOX-11: an image merged in from another testimonial that wasn't public
     * itself. Shown to the owner only, so a merge never publishes anything new.
     */
    ownerOnly: integer("owner_only", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("testimonial_images_key_idx").on(t.key),
    index("testimonial_images_testimonial_idx").on(t.testimonialId, t.position),
  ],
);

/** INBOX-08 highlighted phrases. `phrase` re-anchors offsets after an edit; dropped if no longer found. */
export const highlights = sqliteTable(
  "highlights",
  {
    id: text("id").primaryKey(),
    testimonialId: text("testimonial_id")
      .notNull()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    /** null = the primary text. */
    answerId: text("answer_id").references(() => answers.id, { onDelete: "cascade" }),
    start: integer("start").notNull(),
    end: integer("end").notNull(),
    phrase: text("phrase").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("highlights_testimonial_idx").on(t.testimonialId), index("highlights_answer_idx").on(t.answerId)],
);

/** Edit history (INBOX-10). Rows are only ever inserted. */
export const testimonialHistory = sqliteTable(
  "testimonial_history",
  {
    id: text("id").primaryKey(),
    testimonialId: text("testimonial_id")
      .notNull()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    actor: text("actor", { enum: HISTORY_ACTORS }).notNull(),
    actorEmail: text("actor_email"),
    action: text("action", { enum: HISTORY_ACTIONS }).notNull(),
    /** JSON {field: [before, after]}. */
    diff: text("diff").notNull().default("{}"),
    createdAt: createdAt(),
  },
  (t) => [index("testimonial_history_testimonial_idx").on(t.testimonialId, t.createdAt)],
);

/**
 * Search body per testimonial, kept up to date by triggers (migration 0010)
 * and indexed by the testimonials_fts FTS5 table. The INTEGER PK gives FTS5
 * a rowid that VACUUM cannot renumber (testimonials has a TEXT PK).
 */
export const testimonialSearch = sqliteTable(
  "testimonial_search",
  {
    id: integer("id").primaryKey(),
    testimonialId: text("testimonial_id")
      .notNull()
      .unique()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    body: text("body").notNull().default(""),
  },
  (t) => [index("testimonial_search_project_idx").on(t.projectId)],
);

/** Old slugs of renamed projects, forms and walls, so links keep working. */
export const slugRedirects = sqliteTable(
  "slug_redirects",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: REDIRECT_KINDS }).notNull(),
    /** "" for projects (global namespace); the project id for forms and walls. */
    scope: text("scope").notNull().default(""),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),
    wallId: text("wall_id").references(() => walls.id, { onDelete: "cascade" }),
    /** 0013 (M10): an old link of a review booster page. */
    boosterId: text("booster_id").references(() => boosters.id, { onDelete: "cascade" }),
    oldSlug: text("old_slug").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("slug_redirects_kind_scope_slug_idx").on(t.kind, t.scope, t.oldSlug),
    index("slug_redirects_project_idx").on(t.projectId),
    index("slug_redirects_form_idx").on(t.formId),
    index("slug_redirects_wall_idx").on(t.wallId),
    index("slug_redirects_booster_idx").on(t.boosterId),
  ],
);

/** A saved widget (DISP-01). Soft-deleted, so embeds of a deleted widget show nothing rather than break. */
export const widgets = sqliteTable(
  "widgets",
  {
    /** "w_" + 12 base36; slugSchema forbids "_", so it's never a project slug. */
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    layout: text("layout", { enum: WIDGET_LAYOUTS }).notNull().default("grid"),
    selectionMode: text("selection_mode", { enum: WIDGET_SELECTION_MODES }).notNull().default("auto"),
    manualIds: text("manual_ids").notNull().default("[]"),
    pinnedIds: text("pinned_ids").notNull().default("[]"),
    filters: text("filters").notNull().default("{}"),
    design: text("design").notNull().default("{}"),
    labels: text("labels").notNull().default("{}"),
    /** DISP-04 per-layout options. */
    options: text("options").notNull().default("{}"),
    configVersion: integer("config_version").notNull().default(1),
    connectedFormId: text("connected_form_id").references(() => forms.id, { onDelete: "set null" }),
    placement: text("placement"),
    /** DISP-13 install detection: the last page (origin + path, no query) a view came from, set by the hourly analytics job. */
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    lastSeenOrigin: text("last_seen_origin"),
    lastSeenPath: text("last_seen_path"),
    /** When the "removed" alert went out (no view for 7 days after being live); cleared when a view arrives again. */
    removedAt: integer("removed_at", { mode: "timestamp_ms" }),
    /** The owner hid the in-app alert for this removal. */
    removedDismissed: integer("removed_dismissed", { mode: "boolean" }).notNull().default(false),
    /** DISP-08: the owner's CSS, already sanitised (src/lib/custom-css.ts), applied inside the widget's shadow root only. */
    customCss: text("custom_css").notNull().default(""),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("widgets_project_idx").on(t.projectId), index("widgets_connected_form_idx").on(t.connectedFormId)],
);

/** A wall of love page (WALL-01). */
export const walls = sqliteTable(
  "walls",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    /** Rendered at /wall/<project> in place of the legacy page. */
    isMain: integer("is_main", { mode: "boolean" }).notNull().default(false),
    /** One of our own theme names. */
    theme: text("theme").notNull().default("paper"),
    /** JSON, src/lib/wall-config.ts (hero, nav, tabs, cta, seo, display). */
    config: text("config").notNull().default("{}"),
    logoKey: text("logo_key"),
    coverKey: text("cover_key"),
    /** WALL-07: a PNG or ICO favicon; null = the project's logo. Public while the wall is published. */
    faviconKey: text("favicon_key"),
    featuredTestimonialId: text("featured_testimonial_id").references(() => testimonials.id, { onDelete: "set null" }),
    connectedFormId: text("connected_form_id").references(() => forms.id, { onDelete: "set null" }),
    configVersion: integer("config_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("walls_project_slug_idx").on(t.projectId, t.slug),
    uniqueIndex("walls_project_main_idx").on(t.projectId).where(sql`is_main = 1`),
    index("walls_logo_key_idx").on(t.logoKey),
    index("walls_cover_key_idx").on(t.coverKey),
    index("walls_favicon_key_idx").on(t.faviconKey),
    index("walls_featured_testimonial_idx").on(t.featuredTestimonialId),
    index("walls_connected_form_idx").on(t.connectedFormId),
  ],
);

/** A review rich-snippet script (SEO-02) that injects JSON-LD into the owner's own page. */
export const seoSnippets = sqliteTable(
  "seo_snippets",
  {
    /** "s_" + 12 base36. */
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    schemaType: text("schema_type", { enum: SEO_SCHEMA_TYPES }).notNull().default("Product"),
    /** The same PublicFilters as widgets. */
    scope: text("scope").notNull().default("{}"),
    /** JSON {name, url} of the thing being reviewed. */
    item: text("item").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("seo_snippets_project_idx").on(t.projectId)],
);

/** One table for background tasks the UI polls: imports (with their preview), storage migration, onboarding discovery. */
export const taskRuns = sqliteTable(
  "task_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TASK_RUN_KINDS }).notNull(),
    /** Adapter id | "local->s3" | url. */
    subject: text("subject"),
    input: text("input").notNull().default("{}"),
    options: text("options").notNull().default("{}"),
    /** Up to 50 normalised items exactly as shown, so "import selected" imports what the owner saw. */
    preview: text("preview").notNull().default("[]"),
    selection: text("selection").notNull().default('"all"'),
    status: text("status", { enum: TASK_RUN_STATUSES }).notNull().default("queued"),
    total: integer("total").notNull().default(0),
    done: integer("done").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    errors: text("errors").notNull().default("[]"),
    cursor: text("cursor"),
    jobId: text("job_id"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    /** 0016 (M13, IMP-02): the auto-sync source this run is a scheduled run of; null for a one-off import. */
    sourceId: text("source_id").references((): AnySQLiteColumn => importSources.id, { onDelete: "set null" }),
  },
  (t) => [index("task_runs_project_idx").on(t.projectId, t.createdAt), index("task_runs_source_idx").on(t.sourceId)],
);

/** Slack, Discord, Teams and Telegram destinations for new-testimonial alerts (INT-02). */
export const notificationChannels = sqliteTable(
  "notification_channels",
  {
    id: text("id").primaryKey(),
    /** null = all projects. */
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", { enum: CHANNEL_TYPES }).notNull(),
    name: text("name").notNull(),
    /** Webhook URL or JSON {botToken, chatId}. Needed in full to send; masked in every API response. */
    target: text("target").notNull(),
    events: text("events").notNull().default('["testimonial.created"]'),
    /** JSON list; empty = every form. */
    formIds: text("form_ids").notNull().default("[]"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastSentAt: integer("last_sent_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("notification_channels_project_idx").on(t.projectId)],
);

// 0013 (M10): review booster pages, their link clicks, and reward code pools.

/**
 * A review booster page (BOOST-01) at /b/<project>/<slug>: buttons that send
 * people to the review sites the owner picked. Every visitor sees every link
 * (BOOST-03); a draft is never public.
 */
export const boosters = sqliteTable(
  "boosters",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    title: text("title").notNull().default(""),
    message: text("message").notNull().default(""),
    /** JSON, src/lib/booster-config.ts boosterLinksSchema: up to 10 {id, platform, label, url, formId}. */
    links: text("links").notNull().default("[]"),
    /** JSON, boosterDesignSchema: colours, button style, logo choice. */
    design: text("design").notNull().default("{}"),
    logoKey: text("logo_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("boosters_project_slug_idx").on(t.projectId, t.slug), index("boosters_logo_key_idx").on(t.logoKey)],
);

/** Daily click counts per booster link (BOOST-05). Counts only: no IPs, no user agents, no cookies. */
export const boosterClicks = sqliteTable(
  "booster_clicks",
  {
    boosterId: text("booster_id")
      .notNull()
      .references(() => boosters.id, { onDelete: "cascade" }),
    /** The link's id inside boosters.links (kept after the link is removed, so old days still add up). */
    linkId: text("link_id").notNull(),
    /** UTC day, YYYY-MM-DD. */
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.boosterId, t.linkId, t.day] })],
);

/**
 * A form's pool of unique reward codes (FORM-13), uploaded as a CSV. A code is
 * claimed once, atomically, for one submission (a testimonial or, after the
 * low-rating branch, a feedback row) or one campaign recipient (REQ-08).
 */
export const rewardCodes = sqliteTable(
  "reward_codes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    testimonialId: text("testimonial_id").references(() => testimonials.id, { onDelete: "set null" }),
    feedbackId: text("feedback_id").references(() => feedback.id, { onDelete: "set null" }),
    /** The campaign recipient it's reserved for (REQ-08). */
    requestId: text("request_id").references(() => requests.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reward_codes_form_code_idx").on(t.formId, t.code),
    // The next free code: WHERE form_id = ? AND claimed_at IS NULL.
    index("reward_codes_form_claimed_idx").on(t.formId, t.claimedAt),
    index("reward_codes_project_idx").on(t.projectId),
    // At most one code per submission and per recipient (NULLs never clash).
    uniqueIndex("reward_codes_testimonial_idx").on(t.testimonialId),
    uniqueIndex("reward_codes_feedback_idx").on(t.feedbackId),
    uniqueIndex("reward_codes_request_idx").on(t.requestId),
  ],
);

// 0014 (M11): cookieless analytics (PRD §15, docs/help/analytics.md).

/**
 * Raw analytics events, kept for 30 days and then deleted. No IPs, user
 * agents, cookies or query strings: `visitor` is a hash of IP + user agent +
 * project with a salt that changes every day and is deleted after two, so it
 * can't be reversed or matched across days.
 */
export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    objectType: text("object_type", { enum: ANALYTICS_OBJECTS }).notNull(),
    /** The widget, form, wall or snippet id (no foreign key: one column for four tables, and stats outlive a deleted wall). */
    objectId: text("object_id").notNull(),
    metric: text("metric", { enum: ANALYTICS_METRICS }).notNull(),
    /** The page (origin + path) for widget views and clicks, a form page's index for `step`, the referring site for `render`; "" otherwise. */
    dim: text("dim").notNull().default(""),
    visitor: text("visitor").notNull(),
    /** UTC day, YYYY-MM-DD. */
    day: text("day").notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("analytics_events_project_idx").on(t.projectId, t.day),
    index("analytics_events_object_idx").on(t.objectType, t.objectId, t.day),
    // Covers rolling up a day, the dashboard's live "today" and deleting old days (their GROUP BYs read it in order).
    index("analytics_events_day_idx").on(t.day, t.projectId, t.objectType, t.metric, t.visitor, t.objectId),
  ],
);

/**
 * Daily totals, kept forever. One row per object, day, metric and dim; an
 * empty object_id is the project's total for that type (its visitors are
 * counted once across all of them). `uniques` = distinct visitors that day.
 */
export const analyticsDaily = sqliteTable(
  "analytics_daily",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    objectType: text("object_type", { enum: ANALYTICS_OBJECTS }).notNull(),
    objectId: text("object_id").notNull(),
    day: text("day").notNull(),
    metric: text("metric", { enum: ANALYTICS_METRICS }).notNull(),
    dim: text("dim").notNull().default(""),
    count: integer("count").notNull().default(0),
    uniques: integer("uniques").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.objectType, t.objectId, t.day, t.metric, t.dim] }),
    // The dashboard's "all projects" view.
    index("analytics_daily_day_idx").on(t.day),
  ],
);

/** One random salt per UTC day for the visitor hash; rows older than yesterday are deleted. */
export const analyticsSalts = sqliteTable("analytics_salts", {
  day: text("day").primaryKey(),
  salt: text("salt").notNull(),
  createdAt: createdAt(),
});

/** Days whose raw events have been rolled up into analytics_daily (a finished day is rolled once). */
export const analyticsRollups = sqliteTable("analytics_rollups", {
  day: text("day").primaryKey(),
  events: integer("events").notNull().default(0),
  rolledAt: integer("rolled_at", { mode: "timestamp_ms" }).notNull(),
});

/** Per-person prefs keyed by lower-cased email (D14; the owner signs in before editing prefs, so a members row exists). */
/**
 * An image uploaded in the image studio (SHARE-01): a background or a logo.
 * Owner-only: the studio draws it on the server, so it is never public media.
 */
export const SHARE_ASSET_KINDS = ["background", "logo"] as const;
export type ShareAssetKind = (typeof SHARE_ASSET_KINDS)[number];

export const shareAssets = sqliteTable(
  "share_assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SHARE_ASSET_KINDS }).notNull(),
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("share_assets_project_idx").on(t.projectId), index("share_assets_key_idx").on(t.key)],
);

/** "Save as my template" in the image studio (SHARE-02): a design without any testimonial content. */
export const shareTemplates = sqliteTable(
  "share_templates",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** JSON, src/lib/share/design.ts shareDesignSchema. */
    design: text("design").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("share_templates_project_idx").on(t.projectId)],
);


// 0016 (M13): auto-sync, translations, smart search.

export const SYNC_INTERVALS = [12, 24] as const;
export type SyncInterval = (typeof SYNC_INTERVALS)[number];
export const SYNC_STATUSES = ["ok", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/**
 * An import kept in sync (IMP-02): the same adapter, input and options as a
 * one-off import, re-run every 12 or 24 hours by the scheduler. Runs are
 * ordinary task_runs (source_id points here), deduped like every import.
 */
export const importSources = sqliteTable(
  "import_sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    adapter: text("adapter").notNull(),
    /** The adapter's parsed input (a URL or an ID). Never an API key: keys come from the server's settings. */
    input: text("input").notNull().default("{}"),
    /** JSON, importOptionsSchema: minimum rating, skip empty, tags, status on import. */
    options: text("options").notNull().default("{}"),
    /** A short label for the list, e.g. the page or app it reads. */
    label: text("label").notNull().default(""),
    intervalHours: integer("interval_hours").notNull().default(24),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    lastStatus: text("last_status", { enum: SYNC_STATUSES }),
    lastError: text("last_error"),
    /** Runs in a row that failed; the owner is told at 3 (and it keeps trying on schedule). */
    failures: integer("failures").notNull().default(0),
    /** When the owner was last told about failures; cleared by the next good run. */
    alertedAt: integer("alerted_at", { mode: "timestamp_ms" }),
    /** New testimonials all runs have added. */
    itemsAdded: integer("items_added").notNull().default(0),
    /** The run in progress or the last one (no foreign key: task_runs points here instead). */
    lastRunId: text("last_run_id"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("import_sources_project_idx").on(t.projectId), index("import_sources_next_run_idx").on(t.paused, t.nextRunAt)],
);

/**
 * A testimonial's text in another language (INBOX-13), by hand or from the
 * owner's translation provider (`machine`). Owner-only until the testimonial
 * is public; widgets show it only to visitors whose browser asks for that language.
 */
export const translations = sqliteTable(
  "translations",
  {
    id: text("id").primaryKey(),
    testimonialId: text("testimonial_id")
      .notNull()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    /** Lower-case BCP 47, e.g. "fr" or "pt-br". */
    lang: text("lang").notNull(),
    headline: text("headline"),
    text: text("text"),
    machine: integer("machine", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("translations_testimonial_lang_idx").on(t.testimonialId, t.lang)],
);

/**
 * Smart search (INBOX-14): one embedding per testimonial from the owner's own
 * provider, as float32 bytes. Rebuilt from the text whenever its hash changes,
 * so it's never exported.
 */
export const testimonialEmbeddings = sqliteTable(
  "testimonial_embeddings",
  {
    testimonialId: text("testimonial_id")
      .primaryKey()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    dims: integer("dims").notNull(),
    vector: blob("vector", { mode: "buffer" }).notNull(),
    /** SHA-256 of what was embedded (headline, text, transcript, answers), so unchanged rows aren't sent again. */
    contentHash: text("content_hash").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index("testimonial_embeddings_project_idx").on(t.projectId, t.model)],
);

export const memberPrefs = sqliteTable("member_prefs", {
  email: text("email").primaryKey(),
  /** {newTestimonial:'instant'|'daily'|'off', weeklyPending, importSummary, monthlyReport, widgetRemoved, projectIds:[]}: all off by default. */
  notifications: text("notifications").notNull().default("{}"),
  /** {inboxView:'card'|'table', inboxSort, inboxDir, pageSize}. */
  ui: text("ui").notNull().default("{}"),
  lastDigestAt: integer("last_digest_at", { mode: "timestamp_ms" }),
  lastWeeklyAt: integer("last_weekly_at", { mode: "timestamp_ms" }),
  lastMonthlyAt: integer("last_monthly_at", { mode: "timestamp_ms" }),
  updatedAt: updatedAt(),
});

// ------------------------------------------------------------- M14 (0017)

/** TEAM-01: the projects a member limited to some (members.all_projects false) may open. */
export const memberProjects = sqliteTable(
  "member_projects",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.projectId] }), index("member_projects_project_idx").on(t.projectId)],
);

/** TEAM-01: the projects a key limited to some (api_keys.all_projects false) may reach. */
export const apiKeyProjects = sqliteTable(
  "api_key_projects",
  {
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.apiKeyId, t.projectId] }), index("api_key_projects_project_idx").on(t.projectId)],
);

export const AUDIT_ACTOR_TYPES = ["member", "api_key", "oauth", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/**
 * TEAM-02: who did what. `project_id` has no foreign key on purpose, so the
 * record of deleting a project outlives it. Never holds secrets, IP
 * addresses or user agents.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    actorType: text("actor_type", { enum: AUDIT_ACTOR_TYPES }).notNull(),
    /** The member's email, the key's or grant's id, or "system". */
    actorId: text("actor_id").notNull(),
    /** What the log shows: the email, or the key's name and prefix. */
    actorLabel: text("actor_label").notNull(),
    /** e.g. testimonial.approve, export.csv, api_key.create, oauth.grant. */
    action: text("action").notNull(),
    objectType: text("object_type"),
    objectId: text("object_id"),
    projectId: text("project_id"),
    /** A short line for the log, e.g. the testimonial's author. */
    summary: text("summary").notNull().default(""),
    meta: text("meta").notNull().default("{}"),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at),
    index("audit_log_project_at_idx").on(t.projectId, t.at),
    index("audit_log_actor_at_idx").on(t.actorId, t.at),
    index("audit_log_action_at_idx").on(t.action, t.at),
    index("audit_log_object_idx").on(t.objectType, t.objectId),
  ],
);

export const TRIGGER_PROVIDERS = ["stripe", "shopify"] as const;
export type TriggerProvider = (typeof TRIGGER_PROVIDERS)[number];

/**
 * REQ-07: a native Stripe or Shopify trigger on a campaign. Its endpoint is
 * /api/hooks/<provider>/<id>; every delivery must carry the provider's
 * signature, made with `secret` (entered by the owner, never sent back).
 */
export const campaignTriggers = sqliteTable(
  "campaign_triggers",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: TRIGGER_PROVIDERS }).notNull(),
    /** The provider's signing secret, needed in full to check signatures. Empty until it's entered. */
    secret: text("secret").notNull().default(""),
    /** JSON array of the provider's event names this trigger acts on. */
    events: text("events").notNull().default("[]"),
    delayDays: integer("delay_days").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastEventAt: integer("last_event_at", { mode: "timestamp_ms" }),
    /** What happened to the last delivery, for the campaign page ("Invited ada@…", "Skipped: duplicate"). */
    lastResult: text("last_result"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaign_triggers_campaign_idx").on(t.campaignId)],
);

/** Deliveries already handled (Stripe's event id, Shopify's webhook id), so a retry never invites twice. */
export const triggerEvents = sqliteTable(
  "trigger_events",
  {
    triggerId: text("trigger_id")
      .notNull()
      .references(() => campaignTriggers.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.triggerId, t.externalId] }), index("trigger_events_received_idx").on(t.receivedAt)],
);

/** INT-04: an MCP client that registered itself (RFC 7591, public clients only). */
export const oauthClients = sqliteTable("oauth_clients", {
  /** The client_id (mcpc_ and random characters). */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** JSON array of exact redirect URIs. */
  redirectUris: text("redirect_uris").notNull(),
  createdAt: createdAt(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
});

export const OAUTH_SCOPES = ["read", "write"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/** What a member allowed an MCP client to do: tokens act with the member's own role and project access, within this. */
export const oauthGrants = sqliteTable(
  "oauth_grants",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    memberEmail: text("member_email").notNull(),
    scope: text("scope", { enum: OAUTH_SCOPES }).notNull(),
    allProjects: integer("all_projects", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("oauth_grants_client_idx").on(t.clientId), index("oauth_grants_member_idx").on(t.memberEmail)],
);

export const oauthGrantProjects = sqliteTable(
  "oauth_grant_projects",
  {
    grantId: text("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.grantId, t.projectId] }), index("oauth_grant_projects_project_idx").on(t.projectId)],
);

/** Authorization codes: single use, a few minutes, PKCE S256. Only a hash is stored. */
export const oauthCodes = sqliteTable(
  "oauth_codes",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    memberEmail: text("member_email").notNull(),
    scope: text("scope", { enum: OAUTH_SCOPES }).notNull(),
    /** JSON array of project ids, or null for every project the member can open. */
    projectIds: text("project_ids"),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_codes_client_idx").on(t.clientId)],
);

export const OAUTH_TOKEN_KINDS = ["access", "refresh"] as const;

/** Access tokens (an hour) and refresh tokens (30 days, rotated on use), as hashes. */
export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    grantId: text("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: OAUTH_TOKEN_KINDS }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    /** A refresh token is used once; using it again revokes the whole grant. */
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_tokens_grant_idx").on(t.grantId), index("oauth_tokens_expires_idx").on(t.expiresAt)],
);

// 0019 (M16): video, part 2.

/**
 * multiclip: a submission's answers stitched into one MP4 with title cards
 * (VID-05). social: a vertical or square clip with burned-in captions
 * (VID-07). reel: a highlight reel (VID-08). hls: the adaptive-streaming
 * copy of a testimonial's video (VID-06).
 */
export const RENDER_KINDS = ["multiclip", "social", "reel", "hls"] as const;
export type RenderKind = (typeof RENDER_KINDS)[number];
export const RENDER_STATUSES = ["queued", "processing", "ready", "failed"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

/**
 * A video Plaudit made from stored ones, in a background job. The result is
 * owner-only (D13) unless it becomes a testimonial's video (VID-05) or is
 * the HLS copy of a public one (VID-06).
 */
export const videoRenders = sqliteTable(
  "video_renders",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The testimonial it was made from (multiclip, social, hls); null for a reel. */
    testimonialId: text("testimonial_id").references(() => testimonials.id, { onDelete: "cascade" }),
    reelId: text("reel_id").references((): AnySQLiteColumn => highlightReels.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RENDER_KINDS }).notNull(),
    status: text("status", { enum: RENDER_STATUSES }).notNull().default("queued"),
    /** JSON: what was asked for (look, format, clips…), as validated. */
    options: text("options").notNull().default("{}"),
    error: text("error"),
    /** The MP4, or for hls the master playlist. */
    key: text("key"),
    /** JSON array of every stored file (hls: playlists and segments), so they can be deleted. */
    files: text("files").notNull().default("[]"),
    /** hls: the MP4 it was made from. */
    sourceKey: text("source_key"),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: integer("size_bytes"),
    /** VID-05: this multiclip is the testimonial's video; `replacedKey` is the main answer's own original, put back on undo. */
    usedAsVideo: integer("used_as_video", { mode: "boolean" }).notNull().default(false),
    replacedKey: text("replaced_key"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("video_renders_project_idx").on(t.projectId),
    index("video_renders_testimonial_idx").on(t.testimonialId),
    index("video_renders_reel_idx").on(t.reelId),
    // /api/media looks up which render a file belongs to.
    index("video_renders_key_idx").on(t.key),
    index("video_renders_replaced_key_idx").on(t.replacedKey),
  ],
);

/** VID-08: a highlight reel, kept per project so it can be changed and rendered again. */
export const highlightReels = sqliteTable(
  "highlight_reels",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** JSON, src/lib/video/reels.ts reelConfigSchema: clips with in and out points, cards, music, format. */
    config: text("config").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("highlight_reels_project_idx").on(t.projectId)],
);

export const FORM_VIDEO_SLOTS = ["welcome", "thank_you"] as const;
export type FormVideoSlot = (typeof FORM_VIDEO_SLOTS)[number];

/**
 * FORM-17: the owner's own video on a form's welcome or thank-you page.
 * Converted and transcribed like a testimonial's; public while the form is live.
 */
export const formVideos = sqliteTable(
  "form_videos",
  {
    id: text("id").primaryKey(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    slot: text("slot", { enum: FORM_VIDEO_SLOTS }).notNull(),
    videoKey: text("video_key"),
    videoMime: text("video_mime"),
    videoOriginalKey: text("video_original_key"),
    posterKey: text("poster_key"),
    videoDurationMs: integer("video_duration_ms"),
    videoWidth: integer("video_width"),
    videoHeight: integer("video_height"),
    mediaStatus: text("media_status", { enum: MEDIA_STATUSES }).notNull().default("none"),
    mediaError: text("media_error"),
    transcript: text("transcript"),
    captionsVtt: text("captions_vtt"),
    transcriptStatus: text("transcript_status", { enum: TRANSCRIPT_STATUSES }).notNull().default("none"),
    transcriptError: text("transcript_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("form_videos_form_slot_idx").on(t.formId, t.slot),
    index("form_videos_video_key_idx").on(t.videoKey),
    index("form_videos_video_original_key_idx").on(t.videoOriginalKey),
    index("form_videos_poster_key_idx").on(t.posterKey),
  ],
);

export const CASE_STUDY_STATUSES = ["draft", "published"] as const;
export type CaseStudyStatus = (typeof CASE_STUDY_STATUSES)[number];

/**
 * SHARE-04: a case study made from one testimonial. Its public page and PDF
 * exist only while it's published and the testimonial may have a public page
 * (approved, not withdrawn, public consent), like /t/.
 */
export const caseStudies = sqliteTable(
  "case_studies",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    testimonialId: text("testimonial_id")
      .notNull()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    status: text("status", { enum: CASE_STUDY_STATUSES }).notNull().default("draft"),
    title: text("title").notNull(),
    /** JSON, src/lib/case-studies.ts caseStudyContentSchema: challenge, solution, result, pull quote, metrics. */
    content: text("content").notNull().default("{}"),
    /** When "Draft with AI" last filled it in (null = written by hand or from the template). */
    aiDraftedAt: integer("ai_drafted_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("case_studies_project_idx").on(t.projectId, t.updatedAt), index("case_studies_testimonial_idx").on(t.testimonialId)],
);

export const INSIGHT_REPORT_KINDS = ["voc", "ask", "nps"] as const;
export type InsightReportKind = (typeof INSIGHT_REPORT_KINDS)[number];

/** VOC-01: a saved Voice of Customer, ask-a-question or NPS report: what was asked and what came back, as it was then. */
export const insightReports = sqliteTable(
  "insight_reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: INSIGHT_REPORT_KINDS }).notNull(),
    name: text("name").notNull(),
    /** JSON: the date range, tags, source and question. */
    params: text("params").notNull().default("{}"),
    /** JSON: the report as shown (themes, phrases, breakdown, answer and citations). */
    result: text("result").notNull().default("{}"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("insight_reports_project_idx").on(t.projectId, t.createdAt)],
);

/**
 * NPS-01: one answer to a form's NPS question (0–10 and why). A promoter who
 * opted in to the testimonial step has its testimonial linked; everyone
 * else's answer stays private here.
 */
export const surveyResponses = sqliteTable(
  "survey_responses",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
    testimonialId: text("testimonial_id").references(() => testimonials.id, { onDelete: "set null" }),
    questionKey: text("question_key").notNull(),
    score: integer("score").notNull(),
    /** The follow-up "why". Private. */
    comment: text("comment"),
    authorName: text("author_name"),
    /** Private. */
    authorEmail: text("author_email"),
    createdAt: createdAt(),
  },
  (t) => [
    index("survey_responses_project_created_idx").on(t.projectId, t.createdAt),
    index("survey_responses_form_idx").on(t.formId),
    index("survey_responses_testimonial_idx").on(t.testimonialId),
  ],
);

/**
 * INT-07 (M18): a project's own Stripe connection, for the sales popup and
 * thank-you coupons (flag `commerce`). Stripe calls
 * /api/hooks/stripe-purchases/<id> after a sale; every delivery must be signed
 * with `signing_secret`. `restricted_key` is a Stripe restricted key that
 * may only write promotion codes. Both are stored as entered (they're needed
 * in full) and never sent back, like the campaign triggers' secrets.
 */
export const stripeConnections = sqliteTable(
  "stripe_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The webhook endpoint's signing secret (whsec_…); empty until it's entered. */
    signingSecret: text("signing_secret").notNull().default(""),
    /** rk_… with only "Promotion codes: write"; empty = no thank-you coupons. */
    restrictedKey: text("restricted_key").notNull().default(""),
    /** Off: deliveries are answered but nothing is recorded. */
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Purchases are deleted this many days after they happened. */
    retentionDays: integer("retention_days").notNull().default(90),
    /** Mark testimonials whose email matches a purchase as "Verified purchase". */
    verifyPurchases: integer("verify_purchases", { mode: "boolean" }).notNull().default(true),
    /** What the popup says was bought when Stripe's event names no product ("" = "from us"). */
    defaultProduct: text("default_product").notNull().default(""),
    lastEventAt: integer("last_event_at", { mode: "timestamp_ms" }),
    lastResult: text("last_result"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("stripe_connections_project_idx").on(t.projectId)],
);

/**
 * INT-07: one purchase from the project's Stripe connection, for the sales
 * popup and "Verified purchase". Only what the popup can show is kept: the
 * first name, a city or country, the product and the amount. Never the email
 * (a keyed hash of it, for matching only), the last name, the full address or
 * any card detail. Deleted after the connection's retention (90 days by default).
 */
export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Stripe's event id, so a retried delivery is recorded once. */
    externalId: text("external_id").notNull(),
    /** checkout.session.completed or invoice.paid. */
    eventType: text("event_type").notNull(),
    firstName: text("first_name"),
    /** A city, else a country name. */
    place: text("place"),
    product: text("product"),
    /** In the currency's smallest unit (pence, cents), as Stripe sends it. */
    amount: integer("amount"),
    currency: text("currency"),
    /** HMAC-SHA256 of the normalised email with a key derived from SESSION_SECRET; never the email. */
    emailHash: text("email_hash"),
    purchasedAt: integer("purchased_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("purchases_project_external_idx").on(t.projectId, t.externalId),
    index("purchases_project_time_idx").on(t.projectId, t.purchasedAt),
    index("purchases_project_email_idx").on(t.projectId, t.emailHash),
    index("purchases_time_idx").on(t.purchasedAt),
  ],
);

/**
 * INT-08 (M18): an approved testimonial's social post draft for X and
 * LinkedIn, made from a template on approval and edited in the drawer. The
 * link to its /t/ page is added when it's shared, so it isn't stored.
 */
export const socialDrafts = sqliteTable(
  "social_drafts",
  {
    testimonialId: text("testimonial_id")
      .primaryKey()
      .references(() => testimonials.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** Who last saved it (null = the template). */
    editedBy: text("edited_by"),
    /** When "Rewrite with AI" last filled it in. */
    aiRewrittenAt: integer("ai_rewritten_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("social_drafts_project_idx").on(t.projectId)],
);

export type Member = typeof members.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Testimonial = typeof testimonials.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type ConsentVersion = typeof consentVersions.$inferSelect;
export type ConsentEvent = typeof consentEvents.$inferSelect;
export type TestimonialRequest = typeof requests.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type Form = typeof forms.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type TestimonialImage = typeof testimonialImages.$inferSelect;
export type Highlight = typeof highlights.$inferSelect;
export type TestimonialHistory = typeof testimonialHistory.$inferSelect;
export type TestimonialSearch = typeof testimonialSearch.$inferSelect;
export type SlugRedirect = typeof slugRedirects.$inferSelect;
export type Widget = typeof widgets.$inferSelect;
export type Wall = typeof walls.$inferSelect;
export type SeoSnippet = typeof seoSnippets.$inferSelect;
export type TaskRun = typeof taskRuns.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type MemberPrefs = typeof memberPrefs.$inferSelect;
export type Booster = typeof boosters.$inferSelect;
export type BoosterClick = typeof boosterClicks.$inferSelect;
export type RewardCode = typeof rewardCodes.$inferSelect;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;
export type ShareAsset = typeof shareAssets.$inferSelect;
export type ShareTemplate = typeof shareTemplates.$inferSelect;
export type ImportSource = typeof importSources.$inferSelect;
export type Translation = typeof translations.$inferSelect;
export type TestimonialEmbedding = typeof testimonialEmbeddings.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type CampaignTrigger = typeof campaignTriggers.$inferSelect;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type VideoRender = typeof videoRenders.$inferSelect;
export type HighlightReel = typeof highlightReels.$inferSelect;
export type FormVideo = typeof formVideos.$inferSelect;
export type CaseStudy = typeof caseStudies.$inferSelect;
export type InsightReport = typeof insightReports.$inferSelect;
export type SurveyResponse = typeof surveyResponses.$inferSelect;
export type StripeConnection = typeof stripeConnections.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type SocialDraft = typeof socialDrafts.$inferSelect;
