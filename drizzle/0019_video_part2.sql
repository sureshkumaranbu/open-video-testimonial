CREATE TABLE `form_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`slot` text NOT NULL,
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
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_videos_form_slot_idx` ON `form_videos` (`form_id`,`slot`);--> statement-breakpoint
CREATE INDEX `form_videos_video_key_idx` ON `form_videos` (`video_key`);--> statement-breakpoint
CREATE INDEX `form_videos_video_original_key_idx` ON `form_videos` (`video_original_key`);--> statement-breakpoint
CREATE INDEX `form_videos_poster_key_idx` ON `form_videos` (`poster_key`);--> statement-breakpoint
CREATE TABLE `highlight_reels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `highlight_reels_project_idx` ON `highlight_reels` (`project_id`);--> statement-breakpoint
CREATE TABLE `video_renders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`testimonial_id` text,
	`reel_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`error` text,
	`key` text,
	`files` text DEFAULT '[]' NOT NULL,
	`source_key` text,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`size_bytes` integer,
	`used_as_video` integer DEFAULT false NOT NULL,
	`replaced_key` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reel_id`) REFERENCES `highlight_reels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `video_renders_project_idx` ON `video_renders` (`project_id`);--> statement-breakpoint
CREATE INDEX `video_renders_testimonial_idx` ON `video_renders` (`testimonial_id`);--> statement-breakpoint
CREATE INDEX `video_renders_reel_idx` ON `video_renders` (`reel_id`);--> statement-breakpoint
CREATE INDEX `video_renders_key_idx` ON `video_renders` (`key`);--> statement-breakpoint
CREATE INDEX `video_renders_replaced_key_idx` ON `video_renders` (`replaced_key`);--> statement-breakpoint
ALTER TABLE `testimonials` ADD `hls_key` text;--> statement-breakpoint
CREATE INDEX `testimonials_hls_key_idx` ON `testimonials` (`hls_key`);