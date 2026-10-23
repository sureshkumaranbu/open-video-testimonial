CREATE TABLE `login_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`purpose` text NOT NULL,
	`browser_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_tokens_token_hash_unique` ON `login_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `login_tokens_email_idx` ON `login_tokens` (`email`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'admin' NOT NULL,
	`invited_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`activated_at` integer,
	`last_sign_in_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE TABLE `oauth_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`state` text NOT NULL,
	`nonce` text NOT NULL,
	`code_verifier` text NOT NULL,
	`code` text,
	`user_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_flows_state_unique` ON `oauth_flows` (`state`);