ALTER TABLE course_attempts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE course_material_page_images ADD COLUMN text_ready INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE course_material_page_images SET text_ready=1 WHERE extracted_text<>'';
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0;
