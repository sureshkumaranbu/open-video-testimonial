CREATE TABLE `case_studies` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`testimonial_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '{}' NOT NULL,
	`ai_drafted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `case_studies_project_idx` ON `case_studies` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `case_studies_testimonial_idx` ON `case_studies` (`testimonial_id`);--> statement-breakpoint
CREATE TABLE `insight_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`result` text DEFAULT '{}' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `insight_reports_project_idx` ON `insight_reports` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `survey_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`form_id` text,
	`testimonial_id` text,
	`question_key` text NOT NULL,
	`score` integer NOT NULL,
	`comment` text,
	`author_name` text,
	`author_email` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `survey_responses_project_created_idx` ON `survey_responses` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `survey_responses_form_idx` ON `survey_responses` (`form_id`);--> statement-breakpoint
CREATE INDEX `survey_responses_testimonial_idx` ON `survey_responses` (`testimonial_id`);--> statement-breakpoint
ALTER TABLE `forms` ADD `kind` text DEFAULT 'testimonial' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `ai_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- VOC-01: read-only access to the inbox search index's words (0010), so Voice of Customer can
-- count words and phrases without AI. One row per word occurrence: (term, doc = testimonial_search.id, col, offset).
-- A view over the FTS index itself; it stores nothing and needs no triggers.
CREATE VIRTUAL TABLE `testimonials_fts_vocab` USING fts5vocab(testimonials_fts, instance);
