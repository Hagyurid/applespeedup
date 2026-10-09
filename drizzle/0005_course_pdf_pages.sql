CREATE TABLE `course_material_page_images` (
	`material_id` text NOT NULL,
	`page_num` integer NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`extracted_text` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`material_id`, `page_num`),
	FOREIGN KEY (`material_id`) REFERENCES `course_materials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE course_materials ADD COLUMN provenance TEXT NOT NULL DEFAULT '';
