CREATE INDEX `feedback_form_idx` ON `feedback` (`form_id`);--> statement-breakpoint
CREATE INDEX `feedback_customer_idx` ON `feedback` (`customer_id`);--> statement-breakpoint
CREATE INDEX `feedback_testimonial_idx` ON `feedback` (`testimonial_id`);--> statement-breakpoint
CREATE INDEX `highlights_answer_idx` ON `highlights` (`answer_id`);--> statement-breakpoint
CREATE INDEX `notification_channels_project_idx` ON `notification_channels` (`project_id`);--> statement-breakpoint
CREATE INDEX `requests_form_idx` ON `requests` (`form_id`);--> statement-breakpoint
CREATE INDEX `seo_snippets_project_idx` ON `seo_snippets` (`project_id`);--> statement-breakpoint
CREATE INDEX `slug_redirects_project_idx` ON `slug_redirects` (`project_id`);--> statement-breakpoint
CREATE INDEX `slug_redirects_form_idx` ON `slug_redirects` (`form_id`);--> statement-breakpoint
CREATE INDEX `slug_redirects_wall_idx` ON `slug_redirects` (`wall_id`);--> statement-breakpoint
CREATE INDEX `walls_featured_testimonial_idx` ON `walls` (`featured_testimonial_id`);--> statement-breakpoint
CREATE INDEX `walls_connected_form_idx` ON `walls` (`connected_form_id`);--> statement-breakpoint
CREATE INDEX `webhooks_form_idx` ON `webhooks` (`form_id`);--> statement-breakpoint
CREATE INDEX `widgets_connected_form_idx` ON `widgets` (`connected_form_id`);