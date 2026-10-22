CREATE TABLE `consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`testimonial_id` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`version_id` text,
	`text` text,
	`text_hash` text,
	`scopes` text,
	`ip_hash` text,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `consent_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `consent_events_testimonial_idx` ON `consent_events` (`testimonial_id`);--> statement-breakpoint
CREATE TABLE `consent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`text` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consent_versions_project_version_idx` ON `consent_versions` (`project_id`,`version`);--> statement-breakpoint
ALTER TABLE `projects` ADD `consent_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `consent_scopes` text DEFAULT '["website"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `edited_after_consent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `withdrawn_at` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `withdraw_token_hash` text;