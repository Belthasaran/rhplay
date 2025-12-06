-- Migration: screenshot_005_create_gameversion_screenshots
-- Description: Create junction table to link gameids to screenshots with per-gameid metadata
-- Date: 2025-01-XX
-- 
-- This table allows multiple gameids to share the same screenshot (rsuuid) while maintaining
-- gameid-specific metadata like sequence_no and source_url. This is necessary when different
-- versions of the same game share screenshots but with different ordering or source URLs.
-- 
-- The actual screenshot data (encrypted_data, fernet_key, etc.) is stored once in res_screenshots,
-- but multiple gameids can reference it through this junction table.

CREATE TABLE IF NOT EXISTS gameversion_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gameid TEXT NOT NULL,
  rsuuid TEXT NOT NULL,
  sequence_no INTEGER,
  source_url TEXT,
  file_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (rsuuid) REFERENCES res_screenshots(rsuuid) ON DELETE CASCADE,
  UNIQUE(gameid, rsuuid)
);

CREATE INDEX IF NOT EXISTS idx_gameversion_screenshots_gameid
  ON gameversion_screenshots(gameid);

CREATE INDEX IF NOT EXISTS idx_gameversion_screenshots_rsuuid
  ON gameversion_screenshots(rsuuid);

CREATE INDEX IF NOT EXISTS idx_gameversion_screenshots_gameid_sequence
  ON gameversion_screenshots(gameid, sequence_no);

CREATE INDEX IF NOT EXISTS idx_gameversion_screenshots_source_url
  ON gameversion_screenshots(source_url)
  WHERE source_url IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_gameversion_screenshots_updated
  AFTER UPDATE ON gameversion_screenshots
BEGIN
  UPDATE gameversion_screenshots
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

-- Migrate existing data from res_screenshots to junction table
-- This preserves existing gameid->rsuuid relationships
INSERT INTO gameversion_screenshots (gameid, rsuuid, sequence_no, source_url, file_name, created_at, updated_at)
SELECT 
  gameid,
  rsuuid,
  sequence_no,
  source_url,
  file_name,
  created_at,
  updated_at
FROM res_screenshots
WHERE gameid IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gameversion_screenshots gvs 
    WHERE gvs.gameid = res_screenshots.gameid 
      AND gvs.rsuuid = res_screenshots.rsuuid
  );

