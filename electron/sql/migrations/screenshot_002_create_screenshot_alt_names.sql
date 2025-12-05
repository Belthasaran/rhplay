-- Migration: screenshot_002_create_screenshot_alt_names
-- Description: Create screenshot_alt_names table to track alternate URLs/filenames for duplicate screenshots
-- Date: 2025-01-XX

CREATE TABLE IF NOT EXISTS screenshot_alt_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suuid TEXT NOT NULL,
  alt_source_url TEXT NOT NULL,
  alt_file_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (suuid) REFERENCES res_screenshots(rsuuid),
  UNIQUE(suuid, alt_source_url)
);

CREATE INDEX IF NOT EXISTS idx_screenshot_alt_names_suuid
  ON screenshot_alt_names(suuid);

CREATE INDEX IF NOT EXISTS idx_screenshot_alt_names_url
  ON screenshot_alt_names(alt_source_url);

