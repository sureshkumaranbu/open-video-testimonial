CREATE TABLE `analytics_daily` (
	`project_id` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`day` text NOT NULL,
	`metric` text NOT NULL,
	`dim` text DEFAULT '' NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`uniques` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `object_type`, `object_id`, `day`, `metric`, `dim`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_daily_day_idx` ON `analytics_daily` (`day`);--> statement-breakpoint
CREATE TABLE `analytics_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`metric` text NOT NULL,
	`dim` text DEFAULT '' NOT NULL,
	`visitor` text NOT NULL,
	`day` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_events_project_idx` ON `analytics_events` (`project_id`,`day`);--> statement-breakpoint
CREATE INDEX `analytics_events_object_idx` ON `analytics_events` (`object_type`,`object_id`,`day`);--> statement-breakpoint
CREATE INDEX `analytics_events_day_idx` ON `analytics_events` (`day`,`project_id`,`object_type`,`metric`,`visitor`,`object_id`);--> statement-breakpoint
CREATE TABLE `analytics_rollups` (
	`day` text PRIMARY KEY NOT NULL,
	`events` integer DEFAULT 0 NOT NULL,
	`rolled_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_salts` (
	`day` text PRIMARY KEY NOT NULL,
	`salt` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `widgets` ADD `last_seen_path` text;--> statement-breakpoint
ALTER TABLE `widgets` ADD `removed_at` integer;--> statement-breakpoint
ALTER TABLE `widgets` ADD `removed_dismissed` integer DEFAULT false NOT NULL;