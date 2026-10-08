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
