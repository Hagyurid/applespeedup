ALTER TABLE course_generation_jobs ADD COLUMN generation_options_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(generation_options_json));
