-- 에쁠가속기 v2: D1 schema proposal. Run ONLY after adapting to actual ChatGPT Sites project runtime.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS courses (
 id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 characteristics TEXT NOT NULL DEFAULT '', preferred_mode TEXT NOT NULL DEFAULT 'detailed_note',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS course_members (
 course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 PRIMARY KEY(course_id,user_id)
);
CREATE TABLE IF NOT EXISTS offerings (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 year INTEGER NOT NULL, term TEXT NOT NULL, professor TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(course_id,year,term,professor)
);
CREATE TABLE IF NOT EXISTS course_facts (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 offering_id TEXT REFERENCES offerings(id), fact_key TEXT NOT NULL, fact_value TEXT NOT NULL,
 provenance TEXT NOT NULL DEFAULT '', confidence TEXT NOT NULL CHECK(confidence IN ('official','observed','reported','inferred','unknown')) DEFAULT 'unknown',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS source_assets (
 id TEXT PRIMARY KEY, offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
 source_type TEXT NOT NULL, title TEXT NOT NULL, file_name TEXT NOT NULL DEFAULT '',
 mime_type TEXT NOT NULL DEFAULT '', storage_key TEXT, sha256 TEXT, extract_status TEXT NOT NULL DEFAULT 'pending',
 provenance TEXT NOT NULL DEFAULT '', year_reference INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (extract_status IN ('pending','ready','failed','unsupported'))
);
CREATE TABLE IF NOT EXISTS source_pages (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES source_assets(id) ON DELETE CASCADE,
 page_num INTEGER NOT NULL, text_content TEXT NOT NULL DEFAULT '', verified INTEGER NOT NULL DEFAULT 0,
 UNIQUE(source_id,page_num)
);
CREATE TABLE IF NOT EXISTS source_chunks (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES source_assets(id) ON DELETE CASCADE,
 page_num INTEGER, chunk_index INTEGER NOT NULL, text_content TEXT NOT NULL,
 UNIQUE(source_id,chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_offerings_course ON offerings(course_id,year,term);
CREATE INDEX IF NOT EXISTS idx_assets_offering_type ON source_assets(offering_id,source_type);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON source_chunks(source_id,page_num);
CREATE TABLE IF NOT EXISTS unit_maps (
 id TEXT PRIMARY KEY, offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
 title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft',
 mapping_json TEXT NOT NULL CHECK(json_valid(mapping_json)), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS production_presets (
 id TEXT PRIMARY KEY, course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
 mode TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 settings_json TEXT NOT NULL CHECK(json_valid(settings_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notes (
 id TEXT PRIMARY KEY, offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
 title TEXT NOT NULL, content_markdown TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_by_user_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS note_versions (
 note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
 title TEXT NOT NULL, content_markdown TEXT NOT NULL, source_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_refs_json)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(note_id,revision)
);
CREATE TABLE IF NOT EXISTS problem_packs (
 id TEXT PRIMARY KEY, offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
 title TEXT NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
 created_by_user_id TEXT NOT NULL REFERENCES users(id), mode TEXT NOT NULL, scope TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', preset_version INTEGER NOT NULL DEFAULT 1,
 source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_ids_json)),
 completed_steps_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(completed_steps_json)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(status IN ('pending','partial','needs_review','complete','failed'))
);
CREATE TABLE IF NOT EXISTS job_checkpoints (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 step TEXT NOT NULL, status TEXT NOT NULL, result_ref TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(job_id,step)
);
CREATE TABLE IF NOT EXISTS private_attempts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 pack_id TEXT NOT NULL REFERENCES problem_packs(id), data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
