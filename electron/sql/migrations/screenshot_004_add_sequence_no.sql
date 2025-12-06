-- Migration: screenshot_004_add_sequence_no
-- Description: Add sequence_no column to res_screenshots table to track screenshot ordering
-- Date: 2025-01-XX
-- 
-- The sequence_no column records the order that screenshots are added to the database.
-- The first entry in the images array is typically the main screenshot or title.
-- New screenshots should be inserted with MAX(sequence_no)+1 for each gameid.

ALTER TABLE res_screenshots ADD COLUMN sequence_no INTEGER;

-- Create index for efficient MAX(sequence_no) queries per gameid
CREATE INDEX IF NOT EXISTS idx_res_screenshots_gameid_sequence
  ON res_screenshots(gameid, sequence_no);

-- Backfill existing records: assign sequence_no based on created_at order per gameid
-- This ensures existing screenshots have a sequence_no even if they were added before this migration
-- For each gameid, assign sequence_no starting from 1 based on created_at order
UPDATE res_screenshots
SET sequence_no = (
  SELECT COUNT(*) + 1
  FROM res_screenshots s2
  WHERE s2.gameid = res_screenshots.gameid
    AND (
      (s2.created_at < res_screenshots.created_at)
      OR (s2.created_at = res_screenshots.created_at AND s2.rsuuid < res_screenshots.rsuuid)
    )
)
WHERE sequence_no IS NULL;

