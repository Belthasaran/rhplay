-- Migration: resource_002_create_res_alt_names
-- Description: Create res_alt_names table to track alternate URLs/filenames for duplicate resources
-- Date: 2025-01-XX

CREATE TABLE IF NOT EXISTS res_alt_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruuid TEXT NOT NULL,
  alt_source_url TEXT NOT NULL,
  alt_file_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ruuid) REFERENCES res_attachments(rauuid),
  UNIQUE(ruuid, alt_source_url)
);

CREATE INDEX IF NOT EXISTS idx_res_alt_names_ruuid
  ON res_alt_names(ruuid);

CREATE INDEX IF NOT EXISTS idx_res_alt_names_url
  ON res_alt_names(alt_source_url);

