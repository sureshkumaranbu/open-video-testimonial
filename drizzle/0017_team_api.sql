CREATE TABLE `api_key_projects` (
	`api_key_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`api_key_id`, `project_id`),
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_key_projects_project_idx` ON `api_key_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_label` text NOT NULL,
	`action` text NOT NULL,
	`object_type` text,
	`object_id` text,
	`project_id` text,
	`summary` text DEFAULT '' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_project_at_idx` ON `audit_log` (`project_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_at_idx` ON `audit_log` (`actor_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_action_at_idx` ON `audit_log` (`action`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_object_idx` ON `audit_log` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `campaign_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`provider` text NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`delay_days` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_event_at` integer,
	`last_result` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_triggers_campaign_idx` ON `campaign_triggers` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `member_projects` (
	`member_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`member_id`, `project_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_projects_project_idx` ON `member_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`member_email` text NOT NULL,
	`scope` text NOT NULL,
	`project_ids` text,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_codes_code_hash_unique` ON `oauth_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `oauth_codes_client_idx` ON `oauth_codes` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_grant_projects` (
	`grant_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`grant_id`, `project_id`),
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_grant_projects_project_idx` ON `oauth_grant_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`member_email` text NOT NULL,
	`scope` text NOT NULL,
	`all_projects` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_grants_client_idx` ON `oauth_grants` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_member_idx` ON `oauth_grants` (`member_email`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`grant_id` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_token_hash_unique` ON `oauth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_grant_idx` ON `oauth_tokens` (`grant_id`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_expires_idx` ON `oauth_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `trigger_events` (
	`trigger_id` text NOT NULL,
	`external_id` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`trigger_id`, `external_id`),
	FOREIGN KEY (`trigger_id`) REFERENCES `campaign_triggers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trigger_events_received_idx` ON `trigger_events` (`received_at`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `all_projects` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `all_projects` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `webhooks` ADD `api_key_id` text REFERENCES api_keys(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `webhooks_api_key_idx` ON `webhooks` (`api_key_id`);