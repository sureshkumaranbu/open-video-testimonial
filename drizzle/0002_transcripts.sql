ALTER TABLE `testimonials` ADD `transcript` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `captions_vtt` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `transcript_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `transcript_error` text;