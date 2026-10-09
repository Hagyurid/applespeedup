CREATE TABLE `course_document_versions` (
	`document_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`content_markdown` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`document_id`, `revision`),
	FOREIGN KEY (`document_id`) REFERENCES `course_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `course_generation_jobs` ADD `document_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO course_document_versions(document_id,revision,title,content_markdown,created_at)
SELECT id,revision,title,content_markdown,updated_at FROM course_documents;
--> statement-breakpoint
UPDATE course_generation_jobs SET document_revision=COALESCE((SELECT revision FROM course_documents WHERE id=document_id),0);
