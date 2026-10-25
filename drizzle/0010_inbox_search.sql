-- Inbox search (INBOX-01). testimonial_search holds one search body per testimonial,
-- testimonials_fts indexes it (external content), and triggers keep both current on
-- every write path, including ones that bypass updateTestimonial (media, transcripts,
-- imports). The view is the one definition of what is searchable.
CREATE VIEW `testimonial_search_body` AS
SELECT t.id AS testimonial_id, t.project_id,
  trim(coalesce(t.author_name,'')||' '||coalesce(t.author_email,'')||' '||coalesce(t.author_company,'')||' '||
       coalesce(t.author_title,'')||' '||coalesce(t.headline,'')||' '||coalesce(t.text,'')||' '||coalesce(t.transcript,'')||' '||
       coalesce((SELECT group_concat(g.name,' ') FROM testimonial_tags tt JOIN tags g ON g.id=tt.tag_id WHERE tt.testimonial_id=t.id),'')||' '||
       coalesce((SELECT group_concat(a.text,' ') FROM answers a WHERE a.testimonial_id=t.id),'')) AS body
FROM testimonials t;--> statement-breakpoint
CREATE VIRTUAL TABLE `testimonials_fts` USING fts5(body, content='testimonial_search', content_rowid='id', tokenize='unicode61 remove_diacritics 2');--> statement-breakpoint
-- The standard external-content sync: FTS mirrors testimonial_search row for row.
CREATE TRIGGER `testimonial_search_ai` AFTER INSERT ON `testimonial_search` BEGIN
  INSERT INTO testimonials_fts(rowid, body) VALUES (new.id, new.body);
END;--> statement-breakpoint
CREATE TRIGGER `testimonial_search_ad` AFTER DELETE ON `testimonial_search` BEGIN
  INSERT INTO testimonials_fts(testimonials_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;--> statement-breakpoint
-- Only when the body really changed, so no-op recomputes leave the index alone.
CREATE TRIGGER `testimonial_search_au` AFTER UPDATE OF body ON `testimonial_search` WHEN old.body IS NOT new.body BEGIN
  INSERT INTO testimonials_fts(testimonials_fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO testimonials_fts(rowid, body) VALUES (new.id, new.body);
END;--> statement-breakpoint
-- Body maintenance. Every UPDATE keeps the old body when the view has no row: during a
-- cascading delete the testimonial can already be gone, and a NULL body would fail the
-- NOT NULL check and abort the delete itself. UPDATE OF keeps media and status writes off the index.
CREATE TRIGGER `testimonials_search_ai` AFTER INSERT ON `testimonials` BEGIN
  INSERT INTO testimonial_search(testimonial_id, project_id, body)
  SELECT testimonial_id, project_id, body FROM testimonial_search_body WHERE testimonial_id = new.id;
END;--> statement-breakpoint
CREATE TRIGGER `testimonials_search_au` AFTER UPDATE OF text, transcript, author_name, author_email, author_company, author_title, headline ON `testimonials` BEGIN
  UPDATE testimonial_search SET body = coalesce((SELECT body FROM testimonial_search_body WHERE testimonial_id = new.id), body)
  WHERE testimonial_id = new.id;
END;--> statement-breakpoint
CREATE TRIGGER `testimonial_tags_search_ai` AFTER INSERT ON `testimonial_tags` BEGIN
  UPDATE testimonial_search SET body = coalesce((SELECT body FROM testimonial_search_body WHERE testimonial_id = new.testimonial_id), body)
  WHERE testimonial_id = new.testimonial_id;
END;--> statement-breakpoint
CREATE TRIGGER `testimonial_tags_search_ad` AFTER DELETE ON `testimonial_tags` BEGIN
  UPDATE testimonial_search SET body = coalesce((SELECT body FROM testimonial_search_body WHERE testimonial_id = old.testimonial_id), body)
  WHERE testimonial_id = old.testimonial_id;
END;--> statement-breakpoint
CREATE TRIGGER `tags_search_au` AFTER UPDATE OF name ON `tags` BEGIN
  UPDATE testimonial_search
  SET body = coalesce((SELECT b.body FROM testimonial_search_body b WHERE b.testimonial_id = testimonial_search.testimonial_id), body)
  WHERE testimonial_id IN (SELECT testimonial_id FROM testimonial_tags WHERE tag_id = new.id);
END;--> statement-breakpoint
CREATE TRIGGER `answers_search_ai` AFTER INSERT ON `answers` BEGIN
  UPDATE testimonial_search SET body = coalesce((SELECT body FROM testimonial_search_body WHERE testimonial_id = new.testimonial_id), body)
  WHERE testimonial_id = new.testimonial_id;
END;--> statement-breakpoint
CREATE TRIGGER `answers_search_au` AFTER UPDATE OF text ON `answers` BEGIN
  UPDATE testimonial_search SET body = coalesce((SELECT body FROM testimonial_search_body WHERE testimonial_id = new.testimonial_id), body)
  WHERE testimonial_id = new.testimonial_id;
END;--> statement-breakpoint
CREATE TRIGGER `answers_search_ad` AFTER DELETE ON `answers` BEGIN
  UPDATE testimonial_search SET body = coalesce((SELECT body FROM testimonial_search_body WHERE testimonial_id = old.testimonial_id), body)
  WHERE testimonial_id = old.testimonial_id;
END;--> statement-breakpoint
-- Index every testimonial that's already here (the testimonial_search_ai trigger fills FTS).
INSERT INTO testimonial_search(testimonial_id, project_id, body)
SELECT testimonial_id, project_id, body FROM testimonial_search_body;
