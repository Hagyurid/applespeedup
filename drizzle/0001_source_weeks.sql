-- User-authored optional week metadata for non-exam source assets.
ALTER TABLE source_assets ADD COLUMN weeks_json TEXT NOT NULL DEFAULT '[]';
