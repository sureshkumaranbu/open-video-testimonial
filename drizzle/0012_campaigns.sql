CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`form_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sender_name` text DEFAULT '' NOT NULL,
	`reply_to` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`button_text` text DEFAULT '' NOT NULL,
	`rtl` integer DEFAULT false NOT NULL,
	`reminders` text DEFAULT '[]' NOT NULL,
	`track_opens` integer DEFAULT false NOT NULL,
	`webhook_token_hash` text,
	`webhook_token_prefix` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `campaigns_project_idx` ON `campaigns` (`project_id`);--> statement-breakpoint
CREATE INDEX `campaigns_form_idx` ON `campaigns` (`form_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_webhook_token_idx` ON `campaigns` (`webhook_token_hash`);--> statement-breakpoint
CREATE TABLE `unsubscribes` (
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`project_id`, `email`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `requests` ADD `campaign_id` text REFERENCES campaigns(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `requests` ADD `title` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `custom` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `requests` ADD `scheduled_for` integer;--> statement-breakpoint
ALTER TABLE `requests` ADD `opened_at` integer;--> statement-breakpoint
ALTER TABLE `requests` ADD `clicked_at` integer;--> statement-breakpoint
ALTER TABLE `requests` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `requests` ADD `declined_at` integer;--> statement-breakpoint
CREATE INDEX `requests_campaign_idx` ON `requests` (`campaign_id`);--> statement-breakpoint
-- Unsubscribing becomes project-wide: carry over everyone who already unsubscribed from a request.
INSERT OR IGNORE INTO `unsubscribes` (`project_id`, `email`, `created_at`)
SELECT `project_id`, lower(`email`), coalesce(`unsubscribed_at`, unixepoch() * 1000) FROM `requests` WHERE `unsubscribed_at` IS NOT NULL
