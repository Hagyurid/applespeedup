CREATE TABLE IF NOT EXISTS source_page_images (
 source_id TEXT NOT NULL REFERENCES source_assets(id) ON DELETE CASCADE,
 page_num INTEGER NOT NULL CHECK(page_num BETWEEN 1 AND 1000),
 storage_key TEXT NOT NULL,
 mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(source_id,page_num)
);
