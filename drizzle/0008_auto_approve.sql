ALTER TABLE `projects` ADD `auto_approve` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `auto_approve_min_rating` integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `auto_approve_video` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `auto_approve_since` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `approved_by` text;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `approved_at` integer;--> statement-breakpoint
ALTER TABLE `testimonials` ADD `approval_rule` text;