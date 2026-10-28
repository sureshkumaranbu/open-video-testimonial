ALTER TABLE `uploads` ADD `direct` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `s3_upload_id` text;--> statement-breakpoint
ALTER TABLE `uploads` ADD `content_type` text;--> statement-breakpoint
CREATE INDEX `customers_avatar_key_idx` ON `customers` (`avatar_key`);