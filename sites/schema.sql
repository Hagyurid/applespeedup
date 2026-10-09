-- GENERATED from Drizzle migrations for Node/SQLite tests. Production uses drizzle/*.sql.
PRAGMA foreign_keys=ON;
CREATE TABLE `source_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`offering_id` text NOT NULL,
	`source_type` text NOT NULL,
	`title` text NOT NULL,
	`file_name` text DEFAULT '' NOT NULL,
	`mime_type` text DEFAULT '' NOT NULL,
	`storage_key` text,
	`sha256` text,
	`extract_status` text DEFAULT 'pending' NOT NULL,
	`provenance` text DEFAULT '' NOT NULL,
	`year_reference` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`offering_id`) REFERENCES `offerings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "asset_extract_status" CHECK("source_assets"."extract_status" IN ('pending','ready','failed','unsupported'))
);
--> statement-breakpoint
CREATE INDEX `idx_assets_offering_type` ON `source_assets` (`offering_id`,`source_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_assets_content` ON `source_assets` (`offering_id`,`source_type`,`sha256`);--> statement-breakpoint
CREATE TABLE `private_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pack_id` text NOT NULL,
	`data_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pack_id`) REFERENCES `problem_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attempt_json" CHECK(json_valid("private_attempts"."data_json"))
);
--> statement-breakpoint
CREATE TABLE `job_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`step` text NOT NULL,
	`status` text NOT NULL,
	`result_ref` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_checkpoints_job_step` ON `job_checkpoints` (`job_id`,`step`);--> statement-breakpoint
CREATE TABLE `source_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`page_num` integer,
	`chunk_index` integer NOT NULL,
	`text_content` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chunks_source_index` ON `source_chunks` (`source_id`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `idx_chunks_source_page` ON `source_chunks` (`source_id`,`page_num`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`characteristics` text DEFAULT '' NOT NULL,
	`preferred_mode` text DEFAULT 'detailed_note' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_courses_owner_name` ON `courses` (`owner_user_id`,`name`);--> statement-breakpoint
CREATE TABLE `course_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`offering_id` text,
	`fact_key` text NOT NULL,
	`fact_value` text NOT NULL,
	`provenance` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'unknown' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offering_id`) REFERENCES `offerings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fact_confidence" CHECK("course_facts"."confidence" IN ('official','observed','reported','inferred','unknown'))
);
--> statement-breakpoint
CREATE INDEX `idx_facts_course_offering` ON `course_facts` (`course_id`,`offering_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`offering_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`mode` text NOT NULL,
	`scope` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`preset_version` integer DEFAULT 1 NOT NULL,
	`source_ids_json` text DEFAULT '[]' NOT NULL,
	`completed_steps_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`offering_id`) REFERENCES `offerings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_status" CHECK("jobs"."status" IN ('pending','partial','needs_review','complete','failed')),
	CONSTRAINT "job_sources_json" CHECK(json_valid("jobs"."source_ids_json")),
	CONSTRAINT "job_steps_json" CHECK(json_valid("jobs"."completed_steps_json"))
);
--> statement-breakpoint
CREATE TABLE `course_members` (
	`course_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`course_id`, `user_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "member_role" CHECK("course_members"."role" IN ('owner','editor','viewer'))
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`offering_id` text NOT NULL,
	`title` text NOT NULL,
	`content_markdown` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`creation_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`offering_id`) REFERENCES `offerings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notes_offering_updated` ON `notes` (`offering_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_notes_creation_request` ON `notes` (`offering_id`,`created_by_user_id`,`creation_key`);--> statement-breakpoint
CREATE TABLE `offerings` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`year` integer NOT NULL,
	`term` text NOT NULL,
	`professor` text DEFAULT '' NOT NULL,
	`section` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "offering_year" CHECK("offerings"."year" BETWEEN 1990 AND 2100),
	CONSTRAINT "offering_term" CHECK("offerings"."term" IN ('1','2','여름','겨울'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_offerings_class` ON `offerings` (`course_id`,`year`,`term`,`professor`,`section`);--> statement-breakpoint
CREATE TABLE `problem_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`offering_id` text NOT NULL,
	`title` text NOT NULL,
	`body_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`offering_id`) REFERENCES `offerings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pack_json" CHECK(json_valid("problem_packs"."body_json"))
);
--> statement-breakpoint
CREATE TABLE `source_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`page_num` integer NOT NULL,
	`text_content` text DEFAULT '' NOT NULL,
	`verified` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pages_source_page` ON `source_pages` (`source_id`,`page_num`);--> statement-breakpoint
CREATE TABLE `production_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text,
	`mode` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`settings_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "preset_json" CHECK(json_valid("production_presets"."settings_json"))
);
--> statement-breakpoint
CREATE TABLE `unit_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`offering_id` text NOT NULL,
	`title` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`mapping_json` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`offering_id`) REFERENCES `offerings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_map_json" CHECK(json_valid("unit_maps"."mapping_json"))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `note_versions` (
	`note_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`content_markdown` text NOT NULL,
	`source_refs_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`note_id`, `revision`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "note_refs_json" CHECK(json_valid("note_versions"."source_refs_json"))
);

-- User-authored optional week metadata for non-exam source assets.
ALTER TABLE source_assets ADD COLUMN weeks_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS source_review_pages (
 source_id TEXT NOT NULL REFERENCES source_assets(id) ON DELETE CASCADE,
 page_num INTEGER NOT NULL CHECK(page_num BETWEEN 1 AND 1000),
 recognized_text TEXT NOT NULL,corrected_text TEXT NOT NULL,
 evidence_source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_source_ids_json)),
 unresolved_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(unresolved_json)),
 review_status TEXT NOT NULL DEFAULT 'needs_review' CHECK(review_status IN ('needs_review','reviewed')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_id,page_num)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_generation_runs (
 id TEXT PRIMARY KEY NOT NULL,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
 created_by_user_id TEXT NOT NULL REFERENCES users(id),mode TEXT NOT NULL,scope TEXT NOT NULL DEFAULT '',
 source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_ids_json)),
 status TEXT NOT NULL DEFAULT 'awaiting_outline' CHECK(status IN ('awaiting_outline','outlined','generating','complete','blocked')),
 outline_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(outline_json)),
 note_id TEXT REFERENCES notes(id),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_generation_sections (
 run_id TEXT NOT NULL REFERENCES ai_generation_runs(id) ON DELETE CASCADE,
 section_index INTEGER NOT NULL CHECK(section_index BETWEEN 1 AND 80),
 content_markdown TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(run_id,section_index)
);

CREATE TABLE IF NOT EXISTS source_page_images (
 source_id TEXT NOT NULL REFERENCES source_assets(id) ON DELETE CASCADE,
 page_num INTEGER NOT NULL CHECK(page_num BETWEEN 1 AND 1000),
 storage_key TEXT NOT NULL,
 mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(source_id,page_num)
);

CREATE TABLE IF NOT EXISTS course_materials (
 id TEXT PRIMARY KEY NOT NULL,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL,source_type TEXT NOT NULL,weeks_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(weeks_json)),
 exam_year INTEGER,original_filename TEXT NOT NULL DEFAULT '',mime_type TEXT NOT NULL DEFAULT '',
 storage_key TEXT,sha256 TEXT,original_text TEXT,review_status TEXT NOT NULL DEFAULT 'pending_review',
 page_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS course_materials_dedupe ON course_materials(course_id,source_type,sha256);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS course_material_pages (
 material_id TEXT NOT NULL REFERENCES course_materials(id) ON DELETE CASCADE,page_num INTEGER NOT NULL,
 raw_text TEXT NOT NULL,corrected_text TEXT NOT NULL,evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_json)),
 unresolved_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(unresolved_json)),
 PRIMARY KEY(material_id,page_num)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS course_documents (
 id TEXT PRIMARY KEY NOT NULL,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 type TEXT NOT NULL DEFAULT 'study_note',title TEXT NOT NULL,content_markdown TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS course_problem_packs (
 id TEXT PRIMARY KEY NOT NULL,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL,pack_json TEXT NOT NULL CHECK(json_valid(pack_json)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS course_attempts (
 user_id TEXT NOT NULL REFERENCES users(id),pack_id TEXT NOT NULL REFERENCES course_problem_packs(id) ON DELETE CASCADE,
 question_id TEXT NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,pack_id,question_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS course_casio_projects (
 id TEXT PRIMARY KEY NOT NULL,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL,blueprint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(blueprint_json)),
 program_text TEXT NOT NULL DEFAULT '',manual_text TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS course_generation_jobs (
 id TEXT PRIMARY KEY NOT NULL,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),mode TEXT NOT NULL,scope TEXT NOT NULL DEFAULT '전체',
 source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_ids_json)),
 outline_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(outline_json)),
 status TEXT NOT NULL DEFAULT 'awaiting_outline',
 document_id TEXT REFERENCES course_documents(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS course_generation_parts (
 job_id TEXT NOT NULL REFERENCES course_generation_jobs(id) ON DELETE CASCADE,
 section_index INTEGER NOT NULL,content_markdown TEXT NOT NULL,
 PRIMARY KEY(job_id,section_index)
);

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
