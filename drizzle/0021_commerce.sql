CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`external_id` text NOT NULL,
	`event_type` text NOT NULL,
	`first_name` text,
	`place` text,
	`product` text,
	`amount` integer,
	`currency` text,
	`email_hash` text,
	`purchased_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_project_external_idx` ON `purchases` (`project_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `purchases_project_time_idx` ON `purchases` (`project_id`,`purchased_at`);--> statement-breakpoint
CREATE INDEX `purchases_project_email_idx` ON `purchases` (`project_id`,`email_hash`);--> statement-breakpoint
CREATE INDEX `purchases_time_idx` ON `purchases` (`purchased_at`);--> statement-breakpoint
CREATE TABLE `social_drafts` (
	`testimonial_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`edited_by` text,
	`ai_rewritten_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_drafts_project_idx` ON `social_drafts` (`project_id`);--> statement-breakpoint
CREATE TABLE `stripe_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`signing_secret` text DEFAULT '' NOT NULL,
	`restricted_key` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`retention_days` integer DEFAULT 90 NOT NULL,
	`verify_purchases` integer DEFAULT true NOT NULL,
	`default_product` text DEFAULT '' NOT NULL,
	`last_event_at` integer,
	`last_result` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_connections_project_idx` ON `stripe_connections` (`project_id`);--> statement-breakpoint
ALTER TABLE `testimonials` ADD `verified_purchase_at` integer;