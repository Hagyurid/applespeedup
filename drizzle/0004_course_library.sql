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
