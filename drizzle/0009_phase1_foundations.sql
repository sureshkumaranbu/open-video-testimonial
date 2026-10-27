CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`testimonial_id` text NOT NULL,
	`question_key` text NOT NULL,
	`question_title` text NOT NULL,
	`position` integer NOT NULL,
	`text` text,
	`video_key` text,
	`video_mime` text,
	`video_original_key` text,
	`poster_key` text,
	`video_duration_ms` integer,
	`video_width` integer,
	`video_height` integer,
	`media_status` text DEFAULT 'none' NOT NULL,
	`media_error` text,
	`transcript` text,
	`captions_vtt` text,
	`transcript_status` text DEFAULT 'none' NOT NULL,
	`transcript_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answers_testimonial_question_idx` ON `answers` (`testimonial_id`,`question_key`);--> statement-breakpoint
CREATE INDEX `answers_video_key_idx` ON `answers` (`video_key`);--> statement-breakpoint
CREATE INDEX `answers_video_original_key_idx` ON `answers` (`video_original_key`);--> statement-breakpoint
CREATE INDEX `answers_poster_key_idx` ON `answers` (`poster_key`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`title` text,
	`company` text,
	`website` text,
	`avatar_key` text,
	`socials` text DEFAULT '{}' NOT NULL,
	`custom` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_project_email_idx` ON `customers` (`project_id`,`email`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`form_id` text,
	`customer_id` text,
	`testimonial_id` text,
	`source` text DEFAULT 'private-question' NOT NULL,
	`rating` integer,
	`text` text NOT NULL,
	`author_name` text,
	`author_email` text,
	`trashed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_project_created_idx` ON `feedback` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `forms` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'live' NOT NULL,
	`layout` text DEFAULT 'steps' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`config_version` integer DEFAULT 1 NOT NULL,
	`pages` text DEFAULT '[]' NOT NULL,
	`design` text DEFAULT '{}' NOT NULL,
	`labels` text DEFAULT '{}' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`reward` text DEFAULT '{}' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`logo_key` text,
	`template` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forms_project_slug_idx` ON `forms` (`project_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `forms_project_default_idx` ON `forms` (`project_id`) WHERE is_default = 1;--> statement-breakpoint
CREATE INDEX `forms_logo_key_idx` ON `forms` (`logo_key`);--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`testimonial_id` text NOT NULL,
	`answer_id` text,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`phrase` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`answer_id`) REFERENCES `answers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `highlights_testimonial_idx` ON `highlights` (`testimonial_id`);--> statement-breakpoint
CREATE TABLE `member_prefs` (
	`email` text PRIMARY KEY NOT NULL,
	`notifications` text DEFAULT '{}' NOT NULL,
	`ui` text DEFAULT '{}' NOT NULL,
	`last_digest_at` integer,
	`last_weekly_at` integer,
	`last_monthly_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`target` text NOT NULL,
	`events` text DEFAULT '["testimonial.created"]' NOT NULL,
	`form_ids` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_sent_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seo_snippets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`schema_type` text DEFAULT 'Product' NOT NULL,
	`scope` text DEFAULT '{}' NOT NULL,
	`item` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `slug_redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`project_id` text NOT NULL,
	`form_id` text,
	`wall_id` text,
	`old_slug` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wall_id`) REFERENCES `walls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slug_redirects_kind_scope_slug_idx` ON `slug_redirects` (`kind`,`scope`,`old_slug`);--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`subject` text,
	`input` text DEFAULT '{}' NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`preview` text DEFAULT '[]' NOT NULL,
	`selection` text DEFAULT '"all"' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`cursor` text,
	`job_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_runs_project_idx` ON `task_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `testimonial_history` (
	`id` text PRIMARY KEY NOT NULL,
	`testimonial_id` text NOT NULL,
	`actor` text NOT NULL,
	`actor_email` text,
	`action` text NOT NULL,
	`diff` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `testimonial_history_testimonial_idx` ON `testimonial_history` (`testimonial_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `testimonial_images` (
	`id` text PRIMARY KEY NOT NULL,
	`testimonial_id` text NOT NULL,
	`question_key` text,
	`key` text NOT NULL,
	`alt` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `testimonial_images_key_idx` ON `testimonial_images` (`key`);--> statement-breakpoint
CREATE INDEX `testimonial_images_testimonial_idx` ON `testimonial_images` (`testimonial_id`,`position`);--> statement-breakpoint
CREATE TABLE `testimonial_search` (
	`id` integer PRIMARY KEY NOT NULL,
	`testimonial_id` text NOT NULL,
	`project_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `testimonial_search_testimonial_id_unique` ON `testimonial_search` (`testimonial_id`);--> statement-breakpoint
CREATE INDEX `testimonial_search_project_idx` ON `testimonial_search` (`project_id`);--> statement-breakpoint
CREATE TABLE `walls` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`is_main` integer DEFAULT false NOT NULL,
	`theme` text DEFAULT 'paper' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`logo_key` text,
	`cover_key` text,
	`featured_testimonial_id` text,
	`connected_form_id` text,
	`config_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`featured_testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`connected_form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `walls_project_slug_idx` ON `walls` (`project_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `walls_project_main_idx` ON `walls` (`project_id`) WHERE is_main = 1;--> statement-breakpoint
CREATE INDEX `walls_logo_key_idx` ON `walls` (`logo_key`);--> statement-breakpoint
CREATE INDEX `walls_cover_key_idx` ON `walls` (`cover_key`);--> statement-breakpoint
CREATE TABLE `widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`layout` text DEFAULT 'grid' NOT NULL,
	`selection_mode` text DEFAULT 'auto' NOT NULL,
	`manual_ids` text DEFAULT '[]' NOT NULL,
	`pinned_ids` text DEFAULT '[]' NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`design` text DEFAULT '{}' NOT NULL,
	`labels` text DEFAULT '{}' NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`config_version` integer DEFAULT 1 NOT NULL,
	`connected_form_id` text,
	`placement` text,
	`last_seen_at` integer,
	`last_seen_origin` text,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connected_form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `widgets_project_idx` ON `widgets` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `website` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `business_type` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `logo_key` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `brand` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `onboarding` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `projects_logo_key_idx` ON `projects` (`logo_key`);--> statement-breakpoint
ALTER TABLE `requests` ADD `form_id` text REFERENCES forms(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `form_id` text REFERENCES forms(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `customer_id` text REFERENCES customers(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `headline` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `platform` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `source_review_id` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `source_date` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `date_precision` text DEFAULT 'day' NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `imported_at` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `language` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `author_website` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `author_phone` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `author_socials` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `company_logo_key` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `primary_question` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `custom_fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `hidden_fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `is_featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `pin_order` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `word_count` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `trashed_at` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `status_before_trash` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `consent_public` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `testimonials_project_created_idx` ON `testimonials` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `testimonials_form_idx` ON `testimonials` (`form_id`);--> statement-breakpoint
CREATE INDEX `testimonials_customer_idx` ON `testimonials` (`customer_id`);--> statement-breakpoint
CREATE INDEX `testimonials_company_logo_key_idx` ON `testimonials` (`company_logo_key`);--> statement-breakpoint
CREATE INDEX `testimonials_trashed_at_idx` ON `testimonials` (`trashed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `testimonials_platform_review_idx` ON `testimonials` (`project_id`,`platform`,`source_review_id`);--> statement-breakpoint
ALTER TABLE `webhooks` ADD `form_id` text REFERENCES forms(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `consent_versions_project_hash_idx` ON `consent_versions` (`project_id`,`hash`);--> statement-breakpoint
-- One classic default form per project (D1). config_version 0: pages and settings are filled from the project columns on first use.
INSERT INTO `forms` (`id`,`project_id`,`slug`,`name`,`status`,`layout`,`is_default`,`config_version`,`pages`,`design`,`labels`,`settings`,`reward`,`language`,`created_at`,`updated_at`)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||
       substr('89ab',1+(random() & 3),1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
       `id`,'default','Default form','live','classic',1,0,'[]','{}','{}','{}','{}','en',`created_at`,unixepoch()*1000
FROM `projects`;--> statement-breakpoint
UPDATE `testimonials` SET `form_id` = (SELECT `f`.`id` FROM `forms` `f` WHERE `f`.`project_id` = `testimonials`.`project_id` AND `f`.`is_default` = 1)
WHERE `source` = 'form';--> statement-breakpoint
UPDATE `requests` SET `form_id` = (SELECT `f`.`id` FROM `forms` `f` WHERE `f`.`project_id` = `requests`.`project_id` AND `f`.`is_default` = 1)
