CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`locked_until` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`project_id` text,
	`token_hash` text NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`max_bytes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `questions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `max_video_seconds` integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `video_original_key` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `poster_key` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `video_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `video_width` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `video_height` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `media_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `media_error` text;--> statement-breakpoint
UPDATE `testimonials` SET `video_original_key` = `video_key` WHERE `video_key` IS NOT NULL;
