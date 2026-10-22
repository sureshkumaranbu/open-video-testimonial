CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`thank_you_message` text NOT NULL,
	`accent_color` text DEFAULT '#0f766e' NOT NULL,
	`allow_video` integer DEFAULT true NOT NULL,
	`allow_text` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_project_name_idx` ON `tags` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `testimonial_tags` (
	`testimonial_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`testimonial_id`, `tag_id`),
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `testimonials` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`rating` integer,
	`text` text,
	`author_name` text NOT NULL,
	`author_email` text,
	`author_title` text,
	`author_company` text,
	`avatar_key` text,
	`video_key` text,
	`video_mime` text,
	`consent_at` integer NOT NULL,
	`source` text DEFAULT 'form' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `testimonials_project_status_idx` ON `testimonials` (`project_id`,`status`);