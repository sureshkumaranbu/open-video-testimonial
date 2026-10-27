CREATE TABLE `import_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`adapter` text NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`interval_hours` integer DEFAULT 24 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_status` text,
	`last_error` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`alerted_at` integer,
	`items_added` integer DEFAULT 0 NOT NULL,
	`last_run_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_sources_project_idx` ON `import_sources` (`project_id`);--> statement-breakpoint
CREATE INDEX `import_sources_next_run_idx` ON `import_sources` (`paused`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `testimonial_embeddings` (
	`testimonial_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`model` text NOT NULL,
	`dims` integer NOT NULL,
	`vector` blob NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `testimonial_embeddings_project_idx` ON `testimonial_embeddings` (`project_id`,`model`);--> statement-breakpoint
CREATE TABLE `translations` (
	`id` text PRIMARY KEY NOT NULL,
	`testimonial_id` text NOT NULL,
	`lang` text NOT NULL,
	`headline` text,
	`text` text,
	`machine` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translations_testimonial_lang_idx` ON `translations` (`testimonial_id`,`lang`);--> statement-breakpoint
ALTER TABLE `task_runs` ADD `source_id` text REFERENCES import_sources(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `task_runs_source_idx` ON `task_runs` (`source_id`);--> statement-breakpoint
ALTER TABLE `testimonial_images` ADD `owner_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `merged_into_id` text REFERENCES testimonials(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `testimonials_merged_into_idx` ON `testimonials` (`merged_into_id`);--> statement-breakpoint
CREATE INDEX `consent_events_version_idx` ON `consent_events` (`version_id`);--> statement-breakpoint
CREATE INDEX `requests_testimonial_idx` ON `requests` (`testimonial_id`);--> statement-breakpoint
CREATE INDEX `testimonial_tags_tag_idx` ON `testimonial_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `uploads_project_idx` ON `uploads` (`project_id`);--> statement-breakpoint
CREATE INDEX `webhooks_project_idx` ON `webhooks` (`project_id`);