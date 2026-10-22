CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`company` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`email_status` text DEFAULT 'not_sent' NOT NULL,
	`email_error` text,
	`sent_at` integer,
	`reminders_sent` integer DEFAULT 0 NOT NULL,
	`next_reminder_at` integer,
	`responded_at` integer,
	`testimonial_id` text,
	`unsubscribed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `requests_project_idx` ON `requests` (`project_id`);--> statement-breakpoint
CREATE INDEX `requests_reminder_idx` ON `requests` (`status`,`next_reminder_at`);--> statement-breakpoint
ALTER TABLE `projects` ADD `invite_subject` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `invite_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `reminder_days` text DEFAULT '3,7' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `thank_you_email` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `request_id` text;