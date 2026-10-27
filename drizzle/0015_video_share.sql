CREATE TABLE `share_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `share_assets_project_idx` ON `share_assets` (`project_id`);--> statement-breakpoint
CREATE INDEX `share_assets_key_idx` ON `share_assets` (`key`);--> statement-breakpoint
CREATE TABLE `share_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`design` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `share_templates_project_idx` ON `share_templates` (`project_id`);--> statement-breakpoint
ALTER TABLE `testimonials` ADD `trim_start_ms` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `trim_end_ms` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `poster_at_ms` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `poster_custom` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `walls` ADD `favicon_key` text;--> statement-breakpoint
CREATE INDEX `walls_favicon_key_idx` ON `walls` (`favicon_key`);--> statement-breakpoint
ALTER TABLE `widgets` ADD `custom_css` text DEFAULT '' NOT NULL;