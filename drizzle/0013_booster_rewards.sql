CREATE TABLE `booster_clicks` (
	`booster_id` text NOT NULL,
	`link_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`booster_id`, `link_id`, `day`),
	FOREIGN KEY (`booster_id`) REFERENCES `boosters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `boosters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`design` text DEFAULT '{}' NOT NULL,
	`logo_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boosters_project_slug_idx` ON `boosters` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `boosters_logo_key_idx` ON `boosters` (`logo_key`);--> statement-breakpoint
CREATE TABLE `reward_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`form_id` text NOT NULL,
	`code` text NOT NULL,
	`claimed_at` integer,
	`testimonial_id` text,
	`feedback_id` text,
	`request_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_codes_form_code_idx` ON `reward_codes` (`form_id`,`code`);--> statement-breakpoint
CREATE INDEX `reward_codes_form_claimed_idx` ON `reward_codes` (`form_id`,`claimed_at`);--> statement-breakpoint
CREATE INDEX `reward_codes_project_idx` ON `reward_codes` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reward_codes_testimonial_idx` ON `reward_codes` (`testimonial_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reward_codes_feedback_idx` ON `reward_codes` (`feedback_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reward_codes_request_idx` ON `reward_codes` (`request_id`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `reward_codes` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `slug_redirects` ADD `booster_id` text REFERENCES boosters(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `slug_redirects_booster_idx` ON `slug_redirects` (`booster_id`);